import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { loadingCheckSchema, validateRequest } from '@/lib/validations';

export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(loadingCheckSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { date, vehicleId, materialItemId, projectMasterId, isChecked } = validation.data;

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
