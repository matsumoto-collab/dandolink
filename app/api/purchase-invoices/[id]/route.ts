import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseInvoiceDate, INVOICE_INCLUDE, withFreshSignedUrls } from '@/lib/purchaseInvoice';

interface RouteContext { params: Promise<{ id: string }>; }

// 仕分け中に編集を許すステータス（確定は /confirm で行う）
const EDITABLE_STATUS = ['pending', 'classified'];

const amt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
        if (!inv) return notFoundResponse('仕入請求書');

        const fresh = await withFreshSignedUrls(inv);
        return NextResponse.json(fresh, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('仕入請求書の取得', error);
    }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const data: Record<string, unknown> = {};
        if ('payeeName' in body) data.payeeName = body.payeeName?.toString().trim() || null;
        if ('payeeId' in body) data.payeeId = body.payeeId || null;
        if ('issueDate' in body) data.issueDate = parseInvoiceDate(body.issueDate);
        if ('dueDate' in body) data.dueDate = parseInvoiceDate(body.dueDate);
        if ('totalAmount' in body) data.totalAmount = amt(body.totalAmount);
        if ('taxAmount' in body) data.taxAmount = amt(body.taxAmount);
        if ('projectMasterId' in body) data.projectMasterId = body.projectMasterId || null;
        if ('expenseCategoryId' in body) data.expenseCategoryId = body.expenseCategoryId || null;
        if ('payeeKana' in body) data.payeeKana = body.payeeKana?.toString().trim() || null;
        if ('bankName' in body) data.bankName = body.bankName?.toString().trim() || null;
        if ('branchName' in body) data.branchName = body.branchName?.toString().trim() || null;
        if ('accountType' in body) data.accountType = body.accountType?.toString().trim() || null;
        if ('accountNumber' in body) data.accountNumber = body.accountNumber?.toString().trim() || null;
        if ('accountHolder' in body) data.accountHolder = body.accountHolder?.toString().trim() || null;
        if ('notes' in body) data.notes = body.notes?.toString().trim() || null;
        if ('status' in body) {
            if (!EDITABLE_STATUS.includes(body.status)) return errorResponse('このステータスへは変更できません', 400);
            data.status = body.status;
        }

        // 案件配分（全置換）。下書き保存なので緩く許容＝完全な空行は捨て、合計一致などの厳密チェックは確定時に行う。
        const hasAllocations = Array.isArray(body.allocations);
        if (Object.keys(data).length === 0 && !hasAllocations) return errorResponse('更新対象が指定されていません', 400);

        const exists = await prisma.purchaseInvoice.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return notFoundResponse('仕入請求書');

        const updated = await prisma.$transaction(async (tx) => {
            if (Object.keys(data).length > 0) {
                await tx.purchaseInvoice.update({ where: { id }, data });
            }
            if (hasAllocations) {
                await tx.purchaseInvoiceAllocation.deleteMany({ where: { purchaseInvoiceId: id } });
                const rows = (body.allocations as Array<{ projectMasterId?: string | null; expenseCategoryId?: string | null; amount?: unknown }>)
                    .map((a, i) => ({
                        purchaseInvoiceId: id,
                        projectMasterId: a.projectMasterId || null,
                        expenseCategoryId: a.expenseCategoryId || null,
                        amount: amt(a.amount) ?? 0,
                        sortOrder: i,
                    }))
                    .filter((r) => r.projectMasterId || r.amount > 0); // 完全に空の行は捨てる
                if (rows.length > 0) await tx.purchaseInvoiceAllocation.createMany({ data: rows });
            }
            return tx.purchaseInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
        });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('仕入請求書の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const inv = await prisma.purchaseInvoice.findUnique({ where: { id } });
        if (!inv) return notFoundResponse('仕入請求書');

        // Storage から削除
        const paths = [inv.storagePath, inv.thumbnailPath].filter(Boolean) as string[];
        if (paths.length > 0) {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            if (rmErr) logger.error('Storage remove error:', rmErr);
        }
        // 確定時に作成した支払予定があれば一緒に削除
        if (inv.paymentScheduleId) {
            await prisma.paymentSchedule.delete({ where: { id: inv.paymentScheduleId } }).catch((e) => logger.error('payment schedule delete error:', e));
        }
        await prisma.purchaseInvoice.delete({ where: { id } }); // items は cascade

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('仕入請求書の削除', error);
    }
}
