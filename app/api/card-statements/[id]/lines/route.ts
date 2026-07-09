import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { parseReceiptDate } from '@/lib/receipt';
import { CARD_STATEMENT_LINE_INCLUDE } from '@/lib/cardStatement';

interface RouteContext { params: Promise<{ id: string }>; }

// 符号を保持する金額パーサ（返金行のマイナスを許容）
const signedAmt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s円¥]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
};

// 手動での明細行追加（AIの抽出漏れ・合計不一致の是正用）
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const statement = await prisma.cardStatement.findUnique({ where: { id } });
        if (!statement) return notFoundResponse('明細書');

        const useDate = parseReceiptDate(body.useDate);
        if (!useDate) return errorResponse('利用日を指定してください', 400);
        const storeName = body.storeName?.toString().trim();
        if (!storeName) return errorResponse('店名を入力してください', 400);
        const amount = signedAmt(body.amount);
        if (amount == null) return errorResponse('金額が不正です', 400);

        // PDF行順の末尾に追加
        const last = await prisma.cardStatementLine.findFirst({
            where: { statementId: id },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
        });

        const created = await prisma.cardStatementLine.create({
            data: {
                statementId: id,
                sortOrder: (last?.sortOrder ?? -1) + 1,
                useDate,
                storeName,
                storeCategory: body.storeCategory?.toString().trim() || null,
                amount,
                notes: body.notes?.toString().trim() || null,
            },
            include: CARD_STATEMENT_LINE_INCLUDE,
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('明細行の追加', error);
    }
}
