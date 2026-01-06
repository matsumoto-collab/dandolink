import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all master data
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const [vehicles, workers, managers, settings] = await Promise.all([
            prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.worker.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.manager.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            prisma.systemSettings.findFirst({ where: { id: 'default' } }),
        ]);

        return NextResponse.json({
            vehicles,
            workers,
            managers,
            totalMembers: settings?.totalMembers || 20,
        });
    } catch (error) {
        console.error('Failed to fetch master data:', error);
        return NextResponse.json({ error: 'Failed to fetch master data' }, { status: 500 });
    }
}
