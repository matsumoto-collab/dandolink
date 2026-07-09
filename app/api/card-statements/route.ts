import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { extractCardStatement, resolveLineDate, type ExtractedCardStatement } from '@/lib/cardStatementExtract';
import { parseReceiptDate, SIGNED_URL_TTL } from '@/lib/receipt';
import { CARD_STATEMENT_LINE_INCLUDE, todayJst } from '@/lib/cardStatement';

// 明細書は複数ページ・100行超がありえて Claude の抽出が60秒を超えることがあるため長めに取る（Vercel Pro: 最大300s）。
export const maxDuration = 120;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// 明細書一覧（照合進捗の集計用に行の status のみ同梱。ファイルURLは詳細GETで返す）
export async function GET(_req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const statements = await prisma.cardStatement.findMany({
            orderBy: [{ closingDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            select: {
                id: true,
                cardLabel: true,
                memberName: true,
                cardLast4: true,
                closingDate: true,
                totalAmount: true,
                extractedData: true,
                createdAt: true,
                lines: { select: { status: true } },
            },
        });

        return NextResponse.json(statements, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('明細書一覧の取得', error);
    }
}

// 明細書PDF（or 画像）をアップロード→AIで全明細行を抽出→CardStatement + CardStatementLine を作成する。
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const cardLabel = formData.get('cardLabel')?.toString().trim() || '';
        if (!file) return errorResponse('ファイルが選択されていません', 400);
        if (!cardLabel) return errorResponse('カード名を入力してください', 400);
        if (!ALLOWED_MIME_TYPES.includes(file.type)) return errorResponse('対応していないファイル形式です（画像・PDF）', 400);
        if (file.size > MAX_FILE_SIZE) return errorResponse('ファイルサイズが20MBを超えています', 400);

        const id = randomUUID();
        const buffer = Buffer.from(await file.arrayBuffer());
        const isImage = file.type.startsWith('image/');

        let storagePath: string;
        let thumbnailPath: string | null = null;
        let mimeType: string;
        let fileSize: number;
        let sourceType: string | null = null;
        let extractBase64: string;
        let extractMime: string;

        if (isImage) {
            const rotated = await sharp(buffer).rotate().toBuffer();
            const [displayWebp, thumbWebp] = await Promise.all([
                sharp(rotated).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 2 }).toBuffer(),
                sharp(rotated).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 50, effort: 0 }).toBuffer(),
            ]);
            storagePath = `card-statements/${id}.webp`;
            thumbnailPath = `card-statements/${id}_thumb.webp`;
            mimeType = 'image/webp';
            fileSize = displayWebp.length;
            extractBase64 = displayWebp.toString('base64');
            extractMime = 'image/webp';

            const [up1, up2] = await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
            ]);
            if (up1.error) {
                logger.error('Storage upload error:', up1.error);
                if (thumbnailPath) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([thumbnailPath]);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
            if (up2.error) {
                logger.error('Thumbnail upload error:', up2.error);
                thumbnailPath = null;
            }
        } else {
            storagePath = `card-statements/${id}.pdf`;
            mimeType = 'application/pdf';
            fileSize = buffer.length;
            sourceType = 'pdf';
            extractBase64 = buffer.toString('base64');
            extractMime = 'application/pdf';

            const up = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
            if (up.error) {
                logger.error('Storage upload error:', up.error);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
        }

        // 費目マスタ（アクティブ）を取得し、抽出プロンプトへ費目名を注入する
        const cats = await prisma.expenseCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true },
        });

        // Claude で抽出（失敗してもアップロードは成立させ、行0件の明細書を作って手動行追加で復旧できるようにする）
        let extracted: ExtractedCardStatement | null = null;
        try {
            extracted = await extractCardStatement(
                extractBase64,
                extractMime,
                cats.map((c) => c.name),
            );
        } catch (e) {
            logger.error('明細書の自動読み取りに失敗:', e);
        }

        // 費目の推定照合（完全一致→部分一致）
        const resolveCategory = (hint: string | null | undefined): string | null => {
            if (!hint) return null;
            const match = cats.find((c) => c.name === hint) ?? cats.find((c) => hint.includes(c.name) || c.name.includes(hint));
            return match?.id ?? null;
        };

        // 署名付きURL
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        // 明細行の年補完基準（締め日を読み取れなければ今日(JST)を仮の基準にし、UIで手修正してもらう）
        const closing = parseReceiptDate(extracted?.closingDate) ?? todayJst();

        const created = await prisma.$transaction(async (tx) => {
            const statement = await tx.cardStatement.create({
                data: {
                    id,
                    cardLabel,
                    memberName: extracted?.memberName ?? null,
                    cardLast4: extracted?.cardLast4 ?? null,
                    closingDate: parseReceiptDate(extracted?.closingDate),
                    totalAmount: extracted?.totalAmount ?? null,
                    fileName: file.name,
                    storagePath,
                    thumbnailPath,
                    mimeType,
                    fileSize,
                    sourceType,
                    signedUrl: signedMap.get(storagePath) ?? null,
                    signedUrlExpiresAt: expiresAt,
                    thumbnailSignedUrl: thumbnailPath ? signedMap.get(thumbnailPath) ?? null : null,
                    thumbnailSignedUrlExpiresAt: thumbnailPath ? expiresAt : null,
                    extractedData: extracted
                        ? ({
                              reportedTotal: extracted.totalAmount,
                              computedTotal: extracted.computedTotal,
                              lineCount: extracted.lines.length,
                          } as Prisma.InputJsonValue)
                        : Prisma.JsonNull,
                    uploadedBy: session!.user.id,
                },
            });

            if (extracted && extracted.lines.length > 0) {
                await tx.cardStatementLine.createMany({
                    data: extracted.lines.map((l, i) => ({
                        statementId: statement.id,
                        sortOrder: i,
                        // 月日が読めなかった行は締め日で仮置きし、UIで手修正してもらう
                        useDate: l.useMonth != null && l.useDay != null ? resolveLineDate(closing, l.useMonth, l.useDay) : closing,
                        storeName: l.storeName || '（店名不明）',
                        storeCategory: l.storeCategory,
                        foreignAmount: l.foreignAmount,
                        currency: l.currency,
                        exchangeRate: l.exchangeRate,
                        amount: l.amount,
                        itemDetails: l.itemDetails,
                        expenseCategoryId: resolveCategory(l.suggestedCategory),
                    })),
                });
            }

            return tx.cardStatement.findUnique({
                where: { id: statement.id },
                include: { lines: { orderBy: { sortOrder: 'asc' }, include: CARD_STATEMENT_LINE_INCLUDE } },
            });
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('明細書の取り込み', error);
    }
}
