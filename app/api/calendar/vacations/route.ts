import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, stringifyJsonField, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const vacations = await prisma.vacationRecord.findMany();
        const vacationsMap: Record<string, { employeeIds: string[]; remarks: string }> = {};
        vacations.forEach(v => {
            vacationsMap[v.dateKey] = { employeeIds: parseJsonField<string[]>(v.employeeIds, []), remarks: v.remarks || '' };
        });

        return NextResponse.json(vacationsMap);
    } catch (error) {
        return serverErrorResponse('休暇データの取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { dateKey, employeeIds, remarks } = await request.json();
        if (!dateKey) return validationErrorResponse('dateKeyは必須です');

        if ((!employeeIds || employeeIds.length === 0) && (!remarks || remarks.trim() === '')) {
            await prisma.vacationRecord.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        const vacation = await prisma.vacationRecord.upsert({
            where: { dateKey },
            update: { employeeIds: stringifyJsonField(employeeIds || []), remarks: remarks || null },
            create: { dateKey, employeeIds: stringifyJsonField(employeeIds || []), remarks: remarks || null },
        });

        return NextResponse.json({ ...vacation, employeeIds: parseJsonField<string[]>(vacation.employeeIds, []) });
    } catch (error) {
        return serverErrorResponse('休暇データの設定', error);
    }
}
