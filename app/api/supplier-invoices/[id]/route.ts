import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseReceiptDate } from '@/lib/receipt';
import { SUPPLIER_INVOICE_INCLUDE } from '@/lib/supplierInvoice';

interface RouteContext { params: Promise<{ id: string }>; }

// 請求額は正の金額のみ（円・整数運用だが Decimal(12,2) に合わせ小数2桁まで許容）
const amt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

// 抽出値の手修正（受け箱のセル編集・詳細モーダル）
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.supplierInvoice.findUnique({ where: { id } });
        if (!current) return notFoundResponse('請求書');

        const data: Record<string, unknown> = {};
        if ('payeeName' in body) data.payeeName = body.payeeName?.toString().trim() || null;
        if ('payeeKana' in body) data.payeeKana = body.payeeKana?.toString().trim() || null;
        if ('bankName' in body) data.bankName = body.bankName?.toString().trim() || null;
        if ('branchName' in body) data.branchName = body.branchName?.toString().trim() || null;
        if ('accountType' in body) {
            const t = body.accountType?.toString().trim();
            data.accountType = t === '普通' || t === '当座' ? t : null;
        }
        if ('accountNumber' in body) data.accountNumber = body.accountNumber?.toString().trim() || null;
        if ('accountHolder' in body) data.accountHolder = body.accountHolder?.toString().trim() || null;
        if ('issueDate' in body) data.issueDate = parseReceiptDate(body.issueDate);
        if ('dueDate' in body) data.dueDate = parseReceiptDate(body.dueDate);
        if ('totalAmount' in body) data.totalAmount = amt(body.totalAmount);
        if ('taxAmount' in body) data.taxAmount = amt(body.taxAmount);
        if ('registrationNumber' in body) data.registrationNumber = body.registrationNumber?.toString().trim() || null;
        if ('paymentType' in body) {
            const t = body.paymentType?.toString();
            if (t !== 'transfer' && t !== 'direct_debit' && t !== 'payment_slip') {
                return errorResponse('支払種別が不正です', 400);
            }
            data.paymentType = t;
        }
        if ('notes' in body) data.notes = body.notes?.toString().trim() || null;
        // マスター照合の手動付け外し（UIの検索候補から選択 / 外す）
        if ('payeeId' in body) {
            const payeeId = body.payeeId?.toString() || null;
            if (payeeId) {
                const payee = await prisma.payee.findUnique({ where: { id: payeeId } });
                if (!payee) return errorResponse('指定された振込先マスターが見つかりません', 400);
            }
            data.payeeId = payeeId;
        }

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);
        data.updatedBy = session!.user.id;

        const updated = await prisma.supplierInvoice.update({ where: { id }, data, include: SUPPLIER_INVOICE_INCLUDE });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('請求書の更新', error);
    }
}

// 受け箱からの削除。追加済みでも支払予定側の行は消さない（支払予定が正）。証憑ファイルも削除する。
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { id } = await context.params;
        const invoice = await prisma.supplierInvoice.findUnique({ where: { id } });
        if (!invoice) return notFoundResponse('請求書');

        await prisma.supplierInvoice.delete({ where: { id } });

        const paths = [invoice.storagePath, invoice.thumbnailPath].filter(Boolean) as string[];
        if (paths.length > 0) {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            if (rmErr) logger.error('Storage remove error:', rmErr);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('請求書の削除', error);
    }
}
