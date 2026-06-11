import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { machineSchema } from '@/lib/validations/safety';

/**
 * 持込機械マスター API（安全書類 Phase 2）。admin / manager のみ。
 */

export async function GET() {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const machines = await prisma.machine.findMany({
            where: { isActive: true },
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
        });
        return NextResponse.json(machines, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('機械一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const parsed = machineSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const machine = await prisma.machine.create({ data: parsed.data });
        return NextResponse.json(machine, { status: 201 });
    } catch (error) {
        return serverErrorResponse('機械登録', error);
    }
}
