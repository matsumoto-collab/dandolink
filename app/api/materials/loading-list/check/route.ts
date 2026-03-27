import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const { date, vehicleId, materialItemId, projectMasterId, isChecked } = body;

        if (!date || !vehicleId || !materialItemId || !projectMasterId) {
            return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
        }

        const targetDate = new Date(date);

        const result = await prisma.loadingCheckItem.upsert({
            where: {
                date_vehicleId_materialItemId_projectMasterId: {
                    date: targetDate,
                    vehicleId,
                    materialItemId,
                    projectMasterId,
                },
            },
            update: {
                isChecked: isChecked ?? false,
                checkedBy: session?.user?.id || null,
                checkedAt: isChecked ? new Date() : null,
            },
            create: {
                date: targetDate,
                vehicleId,
                materialItemId,
                projectMasterId,
                isChecked: isChecked ?? false,
                checkedBy: session?.user?.id || null,
                checkedAt: isChecked ? new Date() : null,
            },
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('チェック状態更新', error);
    }
}
