import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';

/**
 * 日額(円)の入力を number|null に正規化する。
 * 未指定/null/空文字 → null、0以上の数値 → 整数化、それ以外 → 400 エラー。
 */
function parseDailyRate(input: unknown): number | null | NextResponse {
    if (input === undefined || input === null || input === '') return null;
    const n = Number(input);
    if (!Number.isFinite(n) || n < 0) return errorResponse('日額は0以上の数値で入力してください', 400);
    return Math.round(n);
}

const serializeVehicle = (v: { dailyRate: unknown } & Record<string, unknown>) => ({
    ...v,
    dailyRate: v.dailyRate != null ? Number(v.dailyRate) : null,
});

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
        return NextResponse.json(vehicles.map(serializeVehicle));
    } catch (error) {
        return serverErrorResponse('車両一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name, dailyRate } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const rate = parseDailyRate(dailyRate);
        if (rate instanceof NextResponse) return rate;

        const vehicle = await prisma.vehicle.create({ data: { name: validatedName, dailyRate: rate } });
        return NextResponse.json(serializeVehicle(vehicle), { status: 201 });
    } catch (error) {
        return serverErrorResponse('車両作成', error);
    }
}
