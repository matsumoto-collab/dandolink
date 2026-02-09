import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const worker = await prisma.worker.update({ where: { id }, data: { name: validatedName } });
        return NextResponse.json(worker);
    } catch (error) {
        return serverErrorResponse('職方更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.worker.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('職方削除', error);
    }
}
