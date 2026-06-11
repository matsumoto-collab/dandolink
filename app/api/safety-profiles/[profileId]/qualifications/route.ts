import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { qualificationCreateSchema } from '@/lib/validations/safety';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';

interface RouteContext { params: Promise<{ profileId: string }>; }

const SIGNED_URL_TTL = 3600; // 1時間

/** 資格証画像の署名URLを付与して返す（パスのみDB保持・URLは都度生成） */
async function withImageUrls<T extends { imagePath: string | null; imageThumbPath: string | null }>(
    qualifications: T[]
): Promise<(T & { imageUrl: string | null; imageThumbUrl: string | null })[]> {
    return Promise.all(
        qualifications.map(async (q) => {
            let imageUrl: string | null = null;
            let imageThumbUrl: string | null = null;
            if (q.imagePath) {
                const { data } = await supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .createSignedUrl(q.imagePath, SIGNED_URL_TTL);
                imageUrl = data?.signedUrl ?? null;
            }
            if (q.imageThumbPath) {
                const { data } = await supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .createSignedUrl(q.imageThumbPath, SIGNED_URL_TTL);
                imageThumbUrl = data?.signedUrl ?? null;
            }
            return { ...q, imageUrl, imageThumbUrl };
        })
    );
}

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
        return NextResponse.json(await withImageUrls(qualifications), {
            headers: { 'Cache-Control': 'no-store' },
        });
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
