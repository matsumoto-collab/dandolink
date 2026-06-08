import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const [vehicles, settings] = await Promise.all([
            prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.systemSettings.findFirst({ where: { id: 'default' } }),
        ]);

        // Decimal の dailyRate は number|null に正規化して返す（クライアントは number で扱う）
        const vehiclesOut = vehicles.map((v) => ({
            ...v,
            dailyRate: v.dailyRate != null ? Number(v.dailyRate) : null,
        }));

        return NextResponse.json(
            { vehicles: vehiclesOut, totalMembers: settings?.totalMembers || 20 },
            { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60, must-revalidate' } }
        );
    } catch (error) {
        return serverErrorResponse('マスタデータ取得', error);
    }
}
