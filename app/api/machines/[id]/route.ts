import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { machineUpdateSchema } from '@/lib/validations/safety';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const existing = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return notFoundResponse('機械');

        const body = await request.json();
        const parsed = machineUpdateSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const machine = await prisma.machine.update({ where: { id }, data: parsed.data });
        return NextResponse.json(machine, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('機械更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        // 既存マスター（Worker等）と同じく論理削除（isActive=false）。
        // 過去の書類スナップショットは data に自立保存されているため影響なし
        const result = await prisma.machine.updateMany({
            where: { id, isActive: true },
            data: { isActive: false },
        });
        if (result.count === 0) return notFoundResponse('機械');

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('機械削除', error);
    }
}
