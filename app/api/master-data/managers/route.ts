import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const managers = await prisma.manager.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
        return NextResponse.json(managers);
    } catch (error) {
        return serverErrorResponse('担当者一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { name } = await request.json();
        if (!name || typeof name !== 'string') return validationErrorResponse('名前は必須です');

        const manager = await prisma.manager.create({ data: { name: name.trim() } });
        return NextResponse.json(manager, { status: 201 });
    } catch (error) {
        return serverErrorResponse('担当者作成', error);
    }
}
