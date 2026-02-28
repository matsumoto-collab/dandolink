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

        return NextResponse.json(
            { vehicles, totalMembers: settings?.totalMembers || 20 },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('マスタデータ取得', error);
    }
}
