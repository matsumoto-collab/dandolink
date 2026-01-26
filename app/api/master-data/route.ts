import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const [vehicles, workers, managers, settings] = await Promise.all([
            prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.worker.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.manager.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.systemSettings.findFirst({ where: { id: 'default' } }),
        ]);

        return NextResponse.json(
            { vehicles, workers, managers, totalMembers: settings?.totalMembers || 20 },
            { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' } }
        );
    } catch (error) {
        return serverErrorResponse('マスタデータ取得', error);
    }
}
