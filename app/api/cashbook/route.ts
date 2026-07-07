import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { parseReceiptDate } from '@/lib/receipt';
import { CASHBOOK_INCLUDE, CASHBOOK_ENTRY_TYPES, withFreshCashbookSignedUrls } from '@/lib/cashbook';
import { sortCashbookEntries } from '@/lib/cashbookSort';

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
            const monthEnd = new Date(Date.UTC(year, month, 1));
            // 月の振り分けは清算日を優先（清算日が未入力の行は取引日）。提出が遅れた領収書は精算した月に載る
            where.OR = [
                { settledAt: { gte: monthStart, lt: monthEnd } },
                { settledAt: null, date: { gte: monthStart, lt: monthEnd } },
            ];

            // 前月繰越 = 当月より前（settledAt ?? date 基準）の全期間の入金合計 − 出金合計
            const sums = await prisma.cashbookEntry.groupBy({
                by: ['entryType'],
                _sum: { amount: true },
                where: {
                    OR: [
                        { settledAt: { lt: monthStart } },
                        { settledAt: null, date: { lt: monthStart } },
                    ],
                },
            });
            const sumOf = (t: string) => Number(sums.find((s) => s.entryType === t)?._sum.amount ?? 0);
            openingBalance = sumOf('in') - sumOf('out');
        }

        // 表示日(settledAt ?? date)→手動並び順(sortOrder ?? seq)→seq の全順序で返す。
        // coalesce ソートは Prisma で書けないため取得後に JS で並べる（個人帳簿の行数なので十分）。
        const rows = sortCashbookEntries(
            await prisma.cashbookEntry.findMany({ where, include: CASHBOOK_INCLUDE })
        );

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
                applicantName: body.applicantName?.toString().trim() || null,
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
