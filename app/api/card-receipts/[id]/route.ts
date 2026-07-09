import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseReceiptDate } from '@/lib/receipt';
import { CARD_RECEIPT_INCLUDE } from '@/lib/cardStatement';

interface RouteContext { params: Promise<{ id: string }>; }

// レシートは正の金額のみ（返金レシートは扱わない。返金は明細行側のマイナス行で表現される）
const amt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

// 抽出値の手修正
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.cardReceipt.findUnique({ where: { id } });
        if (!current) return notFoundResponse('レシート');

        const data: Record<string, unknown> = {};
        if ('storeName' in body) data.storeName = body.storeName?.toString().trim() || null;
        if ('issueDate' in body) data.issueDate = parseReceiptDate(body.issueDate);
        if ('totalAmount' in body) data.totalAmount = amt(body.totalAmount);
        if ('taxAmount' in body) data.taxAmount = amt(body.taxAmount);
        if ('expenseCategoryId' in body) data.expenseCategoryId = body.expenseCategoryId || null;
        if ('cardLabel' in body) data.cardLabel = body.cardLabel?.toString().trim() || null;
        if ('notes' in body) data.notes = body.notes?.toString().trim() || null;

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.cardReceipt.update({ where: { id }, data, include: CARD_RECEIPT_INCLUDE });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('カードレシートの更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const receipt = await prisma.cardReceipt.findUnique({ where: { id }, include: { statementLine: true } });
        if (!receipt) return notFoundResponse('レシート');

        // 同じ画像を共有する他のレシート（1枚の写真から分割した複数件）が無い場合のみ Storage から削除する。
        const sharing = await prisma.cardReceipt.count({ where: { storagePath: receipt.storagePath, id: { not: id } } });

        // 紐付け済みなら先に明細行を未照合へ戻す（FK の SetNull だけでは status='matched' が残るため）。
        await prisma.$transaction(async (tx) => {
            if (receipt.statementLine) {
                await tx.cardStatementLine.update({
                    where: { id: receipt.statementLine.id },
                    data: { cardReceiptId: null, status: 'unmatched', matchedAt: null, matchedBy: null },
                });
            }
            await tx.cardReceipt.delete({ where: { id } });
        });

        if (sharing === 0) {
            const paths = [receipt.storagePath, receipt.thumbnailPath].filter(Boolean) as string[];
            if (paths.length > 0) {
                const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
                if (rmErr) logger.error('Storage remove error:', rmErr);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('カードレシートの削除', error);
    }
}
