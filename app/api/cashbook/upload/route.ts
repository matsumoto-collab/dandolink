import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { extractReceipts, type ExtractedReceipt } from '@/lib/receiptExtract';
import { parseReceiptDate, SIGNED_URL_TTL } from '@/lib/receipt';
import { CASHBOOK_INCLUDE } from '@/lib/cashbook';

// Claude による領収書抽出に時間がかかるため、関数の最大実行時間を延長する（Vercel Pro: 最大300s）。
// 未設定だとデフォルト(約15s)で打ち切られ、アップロードのローディングが返らなくなる。
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// 今日（JST）の日付を UTC 0時の Date に。日付を読み取れなかった出金行の既定値に使う。
const todayJst = (): Date => {
    const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); // YYYY-MM-DD
    return new Date(`${ymd}T00:00:00.000Z`);
};

// 領収書の画像/PDF をアップロード→AI読み取り→出納帳の「出金」行を作成する。
// 処理は app/api/receipts/route.ts POST と同じ流れ（保存先プレフィックスと作成モデルが違うだけ）。
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

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
            storagePath = `cashbook/${id}.webp`;
            thumbnailPath = `cashbook/${id}_thumb.webp`;
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
            storagePath = `cashbook/${id}.pdf`;
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

        // Claude で抽出（失敗してもアップロードは成立させ、手修正できる出金行を作る）。
        // 1枚の画像に複数の領収書が写っていれば複数行に分割する。
        let extractedList: ExtractedReceipt[] = [];
        try {
            extractedList = await extractReceipts(
                extractBase64,
                extractMime,
                cats.map((c) => c.name),
            );
        } catch (e) {
            logger.error('領収書の自動読み取りに失敗:', e);
        }
        // 1件も読み取れなくても、アップロード画像に対して手入力用の1行を必ず作る。
        const toCreate: (ExtractedReceipt | null)[] = extractedList.length > 0 ? extractedList : [null];

        // 費目の推定照合（完全一致→部分一致）
        const resolveCategory = (hint: string | null | undefined): string | null => {
            if (!hint) return null;
            const match = cats.find((c) => c.name === hint) ?? cats.find((c) => hint.includes(c.name) || c.name.includes(hint));
            return match?.id ?? null;
        };

        // 署名付きURL（画像は1回だけアップロード済み。複数行はこの1枚を共有する）
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        const created = [];
        for (let i = 0; i < toCreate.length; i++) {
            const ex = toCreate[i];
            const row = await prisma.cashbookEntry.create({
                data: {
                    id: i === 0 ? id : randomUUID(),
                    // 取込は常に出金。date は NOT NULL のため読み取れなければ今日(JST)で埋めて後から修正してもらう。
                    entryType: 'out',
                    date: parseReceiptDate(ex?.issueDate) ?? todayJst(),
                    amount: ex?.totalAmount ?? 0,
                    description: [ex?.storeName, ex?.summary].filter(Boolean).join(' ') || null,
                    expenseCategoryId: resolveCategory(ex?.suggestedCategory),
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
                    extractedData: ex ? (ex as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                    createdBy: session!.user.id,
                },
                include: CASHBOOK_INCLUDE,
            });
            created.push(row);
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('領収書の取り込み', error);
    }
}
