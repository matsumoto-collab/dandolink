import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrAccountant, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { extractSupplierInvoice, type ExtractedSupplierInvoice } from '@/lib/supplierInvoiceExtract';
import { parseReceiptDate, SIGNED_URL_TTL } from '@/lib/receipt';
import { SUPPLIER_INVOICE_INCLUDE, withFreshSupplierInvoiceSignedUrls, findMatchingPayee } from '@/lib/supplierInvoice';

// Claude による請求書抽出に時間がかかるため、関数の最大実行時間を延長する（Vercel Pro: 最大300s）。
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

// 請求書受け箱の一覧。?added=pending(未追加のみ) | added(追加済みのみ) | 省略(全件)
// 閲覧は支払予定と同じく税理士(accountant)にも開放。変更系は admin のみ。
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAdminOrAccountant();
        if (error) return error;

        const added = new URL(req.url).searchParams.get('added');
        const where: Prisma.SupplierInvoiceWhereInput =
            added === 'pending' ? { paymentScheduleId: null } : added === 'added' ? { NOT: { paymentScheduleId: null } } : {};

        // 支払期日が近い順（期日を読み取れていない行は末尾）
        const invoices = await prisma.supplierInvoice.findMany({
            where,
            orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
            include: SUPPLIER_INVOICE_INCLUDE,
        });

        const refreshed = await Promise.all(invoices.map((r) => withFreshSupplierInvoiceSignedUrls(r)));
        return NextResponse.json(refreshed, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求書受け箱一覧の取得', error);
    }
}

// 請求書の画像/PDF をアップロード→AI読み取り→振込先マスター照合→受け箱のレコードを作成する。
// 処理は app/api/card-receipts/route.ts POST と同じ流れ（保存先プレフィックスと作成モデルが違うだけ）。
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

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
            storagePath = `supplier-invoices/${id}.webp`;
            thumbnailPath = `supplier-invoices/${id}_thumb.webp`;
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
            storagePath = `supplier-invoices/${id}.pdf`;
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

        // Claude で抽出（失敗してもアップロードは成立させ、手修正できるレコードを作る）
        let extracted: ExtractedSupplierInvoice | null = null;
        try {
            extracted = await extractSupplierInvoice(extractBase64, extractMime);
        } catch (e) {
            logger.error('請求書の自動読み取りに失敗:', e);
        }

        // 振込先マスターの自動照合（完全一致のみ。あいまい候補はUI側で人が選ぶ）
        const payee = extracted
            ? await findMatchingPayee(prisma, { accountNumber: extracted.accountNumber, payeeName: extracted.payeeName })
            : null;

        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        const created = await prisma.supplierInvoice.create({
            data: {
                id,
                payeeName: extracted?.payeeName ?? null,
                payeeKana: extracted?.payeeKana ?? null,
                bankName: extracted?.bankName ?? null,
                branchName: extracted?.branchName ?? null,
                accountType: extracted?.accountType ?? null,
                accountNumber: extracted?.accountNumber ?? null,
                accountHolder: extracted?.accountHolder ?? null,
                issueDate: parseReceiptDate(extracted?.issueDate),
                dueDate: parseReceiptDate(extracted?.dueDate),
                totalAmount: extracted?.totalAmount ?? null,
                taxAmount: extracted?.taxAmount ?? null,
                registrationNumber: extracted?.registrationNumber ?? null,
                payeeId: payee?.id ?? null,
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
                uploadedBy: session!.user.id,
            },
            include: SUPPLIER_INVOICE_INCLUDE,
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('請求書の取り込み', error);
    }
}
