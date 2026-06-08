import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

// 日額(円)を number|null に正規化。未指定/null/空 → null、0以上 → 整数化、それ以外 → 400。
function parseDailyRate(input: unknown): number | null | NextResponse {
    if (input === undefined || input === null || input === '') return null;
    const n = Number(input);
    if (!Number.isFinite(n) || n < 0) return errorResponse('日額は0以上の数値で入力してください', 400);
    return Math.round(n);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const { name, dailyRate } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const rate = parseDailyRate(dailyRate);
        if (rate instanceof NextResponse) return rate;

        const vehicle = await prisma.vehicle.update({ where: { id }, data: { name: validatedName, dailyRate: rate } });
        return NextResponse.json({ ...vehicle, dailyRate: vehicle.dailyRate != null ? Number(vehicle.dailyRate) : null });
    } catch (error) {
        return serverErrorResponse('車両更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.vehicle.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('車両削除', error);
    }
}
