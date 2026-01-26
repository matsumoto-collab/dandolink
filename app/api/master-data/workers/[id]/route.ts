import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const { name } = await request.json();
        if (!name || typeof name !== 'string') return validationErrorResponse('名前は必須です');

        const worker = await prisma.worker.update({ where: { id }, data: { name: name.trim() } });
        return NextResponse.json(worker);
    } catch (error) {
        return serverErrorResponse('職方更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        await prisma.worker.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('職方削除', error);
    }
}
