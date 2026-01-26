import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
        return NextResponse.json(vehicles);
    } catch (error) {
        return serverErrorResponse('車両一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { name } = await request.json();
        if (!name || typeof name !== 'string') return validationErrorResponse('名前は必須です');

        const vehicle = await prisma.vehicle.create({ data: { name: name.trim() } });
        return NextResponse.json(vehicle, { status: 201 });
    } catch (error) {
        return serverErrorResponse('車両作成', error);
    }
}
