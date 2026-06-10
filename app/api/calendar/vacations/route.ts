import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, validationErrorResponse, serverErrorResponse, parseDateKeyRangeParams } from '@/lib/api/utils';
import { vacationSchema, validateRequest } from '@/lib/validations';

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        // from/to (YYYY-MM-DD) 指定時は範囲のみ返す。未指定は全件（従来挙動）
        const { range, error: rangeError } = parseDateKeyRangeParams(req);
        if (rangeError) return rangeError;

        const vacations = await prisma.vacationRecord.findMany(
            range ? { where: { dateKey: range } } : undefined
        );
        const vacationsMap: Record<string, { employeeIds: string[]; remarks: string }> = {};
        vacations.forEach(v => {
            vacationsMap[v.dateKey] = { employeeIds: parseJsonField<string[]>(v.employeeIds, []), remarks: v.remarks || '' };
        });

        return NextResponse.json(vacationsMap, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('休暇データの取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(vacationSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const { dateKey, employeeIds, remarks } = validation.data;

        if ((!employeeIds || employeeIds.length === 0) && (!remarks || remarks.trim() === '')) {
            await prisma.vacationRecord.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        const vacation = await prisma.vacationRecord.upsert({
            where: { dateKey },
            update: { employeeIds: JSON.stringify(employeeIds || []), remarks: remarks || null },
            create: { dateKey, employeeIds: JSON.stringify(employeeIds || []), remarks: remarks || null },
        });

        return NextResponse.json({ ...vacation, employeeIds: parseJsonField<string[]>(vacation.employeeIds, []) });
    } catch (error) {
        return serverErrorResponse('休暇データの設定', error);
    }
}
