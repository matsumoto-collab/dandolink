import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { extractReceipt } from '@/lib/receiptExtract';
import { parseReceiptDate, RECEIPT_INCLUDE, SIGNED_URL_TTL, withFreshSignedUrls } from '@/lib/receipt';

// Claude による領収書抽出に時間がかかるため、関数の最大実行時間を延長する（Vercel Pro: 最大300s）。
// 未設定だとデフォルト(約15s)で打ち切られ、アップロードのローディングが返らなくなる。
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const url = new URL(req.url);
        const status = url.searchParams.get('status');
        const yearRaw = url.searchParams.get('year');
        const monthRaw = url.searchParams.get('month');
        const year = Number(yearRaw);
        const month = Number(monthRaw);

        const where: Prisma.ReceiptWhereInput = {};
        if (status) where.status = status;
        // 仕分け済みタブは締め月ごとに表示。確定時に issueDate を必須化するため issueDate 単独でフィルタできる。
        // year/month が未指定（null→Number で 0）のときは範囲を付けない。
        if (status === 'confirmed' && yearRaw && monthRaw && Number.isInteger(year) && month >= 1 && month <= 12) {
            where.issueDate = {
                gte: new Date(Date.UTC(year, month - 1, 1)),
                lt: new Date(Date.UTC(year, month, 1)),
            };
        }

        const orderBy: Prisma.ReceiptOrderByWithRelationInput[] =
            status === 'confirmed' ? [{ issueDate: 'desc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }];

        const receipts = await prisma.receipt.findMany({ where, orderBy, include: RECEIPT_INCLUDE });

        // 署名付きURLを必要に応じて再生成
        const refreshed = await Promise.all(receipts.map((r) => withFreshSignedUrls(r)));

        return NextResponse.json(refreshed, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('領収書一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) return errorResponse('ファイルが選択されていません', 400);
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
            storagePath = `receipts/${id}.webp`;
            thumbnailPath = `receipts/${id}_thumb.webp`;
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
            storagePath = `receipts/${id}.pdf`;
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

        // Claude で抽出（失敗してもアップロードは成立させ、pending で保存して手動仕分け可能にする）
        let extracted = null;
        try {
            extracted = await extractReceipt(
                extractBase64,
                extractMime,
                cats.map((c) => c.name),
            );
        } catch (e) {
            logger.error('領収書の自動読み取りに失敗:', e);
        }

        // 費目の推定照合（完全一致→部分一致）
        let expenseCategoryId: string | null = null;
        if (extracted?.suggestedCategory) {
            const hint = extracted.suggestedCategory;
            const match = cats.find((c) => c.name === hint) ?? cats.find((c) => hint.includes(c.name) || c.name.includes(hint));
            expenseCategoryId = match?.id ?? null;
        }

        // 署名付きURL
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        const created = await prisma.receipt.create({
            data: {
                id,
                status: 'pending',
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
                extractedData: extracted ? (extracted as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                storeName: extracted?.storeName ?? null,
                issueDate: parseReceiptDate(extracted?.issueDate),
                totalAmount: extracted?.totalAmount ?? null,
                taxAmount: extracted?.taxAmount ?? null,
                expenseCategoryId,
                uploadedBy: session!.user.id,
            },
            include: RECEIPT_INCLUDE,
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('領収書のアップロード', error);
    }
}
