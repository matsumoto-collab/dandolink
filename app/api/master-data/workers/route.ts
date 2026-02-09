import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const workers = await prisma.worker.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
        return NextResponse.json(workers);
    } catch (error) {
        return serverErrorResponse('職方一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const worker = await prisma.worker.create({ data: { name: validatedName } });
        return NextResponse.json(worker, { status: 201 });
    } catch (error) {
        return serverErrorResponse('職方作成', error);
    }
}
