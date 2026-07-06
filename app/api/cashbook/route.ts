import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { parseReceiptDate } from '@/lib/receipt';
import { CASHBOOK_INCLUDE, CASHBOOK_ENTRY_TYPES, withFreshCashbookSignedUrls } from '@/lib/cashbook';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const url = new URL(req.url);
        const scope = url.searchParams.get('scope') ?? 'month';

        const where: Prisma.CashbookEntryWhereInput = {};
        let openingBalance = 0;

        if (scope !== 'all') {
            const year = Number(url.searchParams.get('year'));
            const month = Number(url.searchParams.get('month'));
            if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
                return errorResponse('year/month を指定してください', 400);
            }
            const monthStart = new Date(Date.UTC(year, month - 1, 1));
            where.date = { gte: monthStart, lt: new Date(Date.UTC(year, month, 1)) };

            // 前月繰越 = 当月より前の全期間の入金合計 − 出金合計
            const sums = await prisma.cashbookEntry.groupBy({
                by: ['entryType'],
                _sum: { amount: true },
                where: { date: { lt: monthStart } },
            });
            const sumOf = (t: string) => Number(sums.find((s) => s.entryType === t)?._sum.amount ?? 0);
            openingBalance = sumOf('in') - sumOf('out');
        }

        // 残高計算が決定的になるよう、日付→登録順(seq)の全順序で返す
        const rows = await prisma.cashbookEntry.findMany({
            where,
            orderBy: [{ date: 'asc' }, { seq: 'asc' }],
            include: CASHBOOK_INCLUDE,
        });

        // 署名付きURLを必要に応じて再生成（証憑ありの行のみ）
        const entries = await Promise.all(rows.map((r) => withFreshCashbookSignedUrls(r)));

        return NextResponse.json({ openingBalance, entries }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('現金出納帳の取得', error);
    }
}

// 手打ちの行を作成する（入金・出金の両方）。領収書からの取込は /api/cashbook/upload。
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const body = await req.json().catch(() => ({}));

        const date = parseReceiptDate(body.date);
        if (!date) return errorResponse('日付が不正です', 400);
        if (!CASHBOOK_ENTRY_TYPES.includes(body.entryType)) return errorResponse('入金/出金の区分が不正です', 400);
        // 「行を追加→セルで金額入力」のフローを許すため金額 0 での作成を認める
        const amount = body.amount == null ? 0 : Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0) return errorResponse('金額が不正です', 400);

        const created = await prisma.cashbookEntry.create({
            data: {
                date,
                entryType: body.entryType,
                amount,
                description: body.description?.toString().trim() || null,
                expenseCategoryId: body.expenseCategoryId || null,
                createdBy: session!.user.id,
            },
            include: CASHBOOK_INCLUDE,
        });
        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('現金出納帳の登録', error);
    }
}
