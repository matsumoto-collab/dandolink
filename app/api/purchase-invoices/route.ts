import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { extractPurchaseInvoice } from '@/lib/purchaseInvoiceExtract';
import { parseInvoiceDate, INVOICE_INCLUDE, SIGNED_URL_TTL, withFreshSignedUrls } from '@/lib/purchaseInvoice';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const status = new URL(req.url).searchParams.get('status');
        const where = status ? { status } : {};

        const invoices = await prisma.purchaseInvoice.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: INVOICE_INCLUDE,
        });

        // 署名付きURLを必要に応じて再生成
        const refreshed = await Promise.all(invoices.map((inv) => withFreshSignedUrls(inv)));

        return NextResponse.json(refreshed, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('仕入請求書一覧の取得', error);
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
            storagePath = `purchase-invoices/${id}.webp`;
            thumbnailPath = `purchase-invoices/${id}_thumb.webp`;
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
            storagePath = `purchase-invoices/${id}.pdf`;
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

        // Claude で抽出（失敗してもアップロードは成立させ、pending で保存して手動仕分け可能にする）
        let extracted = null;
        try {
            extracted = await extractPurchaseInvoice(extractBase64, extractMime);
        } catch (e) {
            logger.error('仕入請求書の自動読み取りに失敗:', e);
        }

        // 費目の推定照合（抽出した分類語を ExpenseCategory.name と部分一致）
        let expenseCategoryId: string | null = null;
        if (extracted?.suggestedCategory) {
            const cats = await prisma.expenseCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } });
            const hint = extracted.suggestedCategory;
            const match = cats.find((c) => hint.includes(c.name) || c.name.includes(hint));
            expenseCategoryId = match?.id ?? null;
        }

        // 署名付きURL
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        const created = await prisma.purchaseInvoice.create({
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
                payeeName: extracted?.payeeName ?? null,
                issueDate: parseInvoiceDate(extracted?.issueDate),
                dueDate: parseInvoiceDate(extracted?.dueDate),
                totalAmount: extracted?.totalAmount ?? null,
                taxAmount: extracted?.taxAmount ?? null,
                expenseCategoryId,
                uploadedBy: session!.user.id,
                items:
                    extracted && extracted.items.length > 0
                        ? {
                              create: extracted.items.map((it, i) => ({
                                  name: it.name,
                                  quantity: it.quantity,
                                  unit: it.unit,
                                  unitPrice: it.unitPrice,
                                  amount: it.amount,
                                  sortOrder: i,
                              })),
                          }
                        : undefined,
            },
            include: INVOICE_INCLUDE,
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('仕入請求書のアップロード', error);
    }
}
