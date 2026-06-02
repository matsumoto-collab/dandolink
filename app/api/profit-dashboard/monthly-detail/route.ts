import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { prisma } from '@/lib/prisma';
import { fetchMonthlyAssigneeBreakdown } from '@/lib/profitDashboard';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** GET ?year=&month= → 当該月の案件担当者別 売上/原価/粗利 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const year = Number(searchParams.get('year'));
        const month = Number(searchParams.get('month'));
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            return validationErrorResponse('year/month が不正です');
        }

        const data = await fetchMonthlyAssigneeBreakdown(year, month);
        return NextResponse.json(data, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('月次担当者別内訳の取得', error);
    }
}

const putSchema = z.object({
    year: z.number().int().min(2000).max(3000),
    month: z.number().int().min(1).max(12),
    projectId: z.string().min(1),
    // number = 手修正の上書き値 / null = 上書きを解除して自動値へ戻す
    cost: z.number().min(0).max(1_000_000_000).nullable(),
});

/** PUT 案件×月の原価上書きを保存/解除し、更新後の内訳を返す */
export async function PUT(request: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json().catch(() => null);
        const parsed = putSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力が不正です', parsed.error.flatten());
        }
        const { year, month, projectId, cost } = parsed.data;

        if (cost === null) {
            // 上書き解除（行削除）→ 自動値に戻る
            await prisma.monthlyProjectCostOverride.deleteMany({ where: { year, month, projectId } });
        } else {
            await prisma.monthlyProjectCostOverride.upsert({
                where: { year_month_projectId: { year, month, projectId } },
                create: { year, month, projectId, cost, updatedBy: session!.user.id },
                update: { cost, updatedBy: session!.user.id },
            });
        }

        // 更新後の内訳（合計含む）を返し、クライアントを一貫した状態にする
        const data = await fetchMonthlyAssigneeBreakdown(year, month);
        return NextResponse.json(data, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('月次案件別原価の保存', error);
    }
}
