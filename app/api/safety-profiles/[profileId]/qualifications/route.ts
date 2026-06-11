import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { qualificationCreateSchema } from '@/lib/validations/safety';

interface RouteContext { params: Promise<{ profileId: string }>; }

export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId } = await context.params;
        const profile = await prisma.workerSafetyProfile.findUnique({
            where: { id: profileId },
            select: { id: true },
        });
        if (!profile) return notFoundResponse('安全プロフィール');

        const qualifications = await prisma.workerQualification.findMany({
            where: { profileId },
            orderBy: { createdAt: 'asc' },
        });
        return NextResponse.json(qualifications, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('資格一覧取得', error);
    }
}

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId } = await context.params;
        const profile = await prisma.workerSafetyProfile.findUnique({
            where: { id: profileId },
            select: { id: true },
        });
        if (!profile) return notFoundResponse('安全プロフィール');

        const body = await request.json();
        const parsed = qualificationCreateSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const qualification = await prisma.workerQualification.create({
            data: { profileId, ...parsed.data },
        });
        return NextResponse.json(qualification, { status: 201 });
    } catch (error) {
        return serverErrorResponse('資格登録', error);
    }
}
