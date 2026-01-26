import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

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
        if (!name || typeof name !== 'string') return validationErrorResponse('名前は必須です');

        const worker = await prisma.worker.create({ data: { name: name.trim() } });
        return NextResponse.json(worker, { status: 201 });
    } catch (error) {
        return serverErrorResponse('職方作成', error);
    }
}
