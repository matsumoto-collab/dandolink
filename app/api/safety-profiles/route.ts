import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { safetyProfileUpsertSchema } from '@/lib/validations/safety';

/**
 * 安全プロフィール API（安全書類 Phase 1）。
 * 個人情報を含むため admin / manager のみアクセス可（要件§8）。
 *
 * GET  /api/safety-profiles                  … Worker/User 統合一覧（書類作成・設定画面の選択肢用）
 * GET  /api/safety-profiles?workerId=… 等    … 単体取得（未登録は null を返す）
 * PUT  /api/safety-profiles?workerId=… 等    … upsert（対象はクエリで指定。パスIDは使わない）
 */

const QUALIFICATIONS_INCLUDE = {
    qualifications: { orderBy: { createdAt: 'asc' as const } },
};

function parseTargetParams(request: NextRequest): { workerId: string | null; userId: string | null; error: NextResponse | null } {
    const { searchParams } = new URL(request.url);
    const workerId = searchParams.get('workerId');
    const userId = searchParams.get('userId');
    if (workerId && userId) {
        return { workerId: null, userId: null, error: validationErrorResponse('workerId と userId は同時に指定できません') };
    }
    return { workerId, userId, error: null };
}

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { workerId, userId, error: paramError } = parseTargetParams(request);
        if (paramError) return paramError;

        // 単体取得（未登録なら null — フロントは空フォームを出す）
        if (workerId || userId) {
            const profile = await prisma.workerSafetyProfile.findUnique({
                where: workerId ? { workerId } : { userId: userId! },
                include: QUALIFICATIONS_INCLUDE,
            });
            return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
        }

        // 統合一覧。User には協力会社（PARTNER）も含む — 一次下請として名簿に正規記載する
        // 運用があるため除外しない（FR-1-0b）。グループ分けはフロントが role から行う。
        const [workers, users] = await Promise.all([
            prisma.worker.findMany({
                where: { isActive: true },
                orderBy: { name: 'asc' },
                include: { safetyProfile: { include: QUALIFICATIONS_INCLUDE } },
            }),
            prisma.user.findMany({
                where: { isActive: true },
                orderBy: { displayName: 'asc' },
                select: {
                    id: true,
                    displayName: true,
                    role: true,
                    companyId: true,
                    company: { select: { displayName: true } },
                    safetyProfile: { include: QUALIFICATIONS_INCLUDE },
                },
            }),
        ]);

        const targets = [
            ...users.map((u) => ({
                key: `user:${u.id}`,
                source: 'user' as const,
                sourceId: u.id,
                name: u.displayName,
                role: u.role,
                companyId: u.companyId,
                companyName: u.company?.displayName ?? null,
                profile: u.safetyProfile,
            })),
            ...workers.map((w) => ({
                key: `worker:${w.id}`,
                source: 'worker' as const,
                sourceId: w.id,
                name: w.name,
                role: null,
                companyId: null,
                companyName: null,
                profile: w.safetyProfile,
            })),
        ];

        return NextResponse.json(targets, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('安全プロフィール一覧取得', error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { workerId, userId, error: paramError } = parseTargetParams(request);
        if (paramError) return paramError;
        if (!workerId && !userId) {
            return validationErrorResponse('workerId または userId を指定してください');
        }

        // 対象の存在確認（404を upsert 前に確定させる）
        if (workerId) {
            const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { id: true } });
            if (!worker) return notFoundResponse('職方');
        } else {
            const user = await prisma.user.findUnique({ where: { id: userId! }, select: { id: true } });
            if (!user) return notFoundResponse('ユーザー');
        }

        const body = await request.json();
        const parsed = safetyProfileUpsertSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const profile = await prisma.workerSafetyProfile.upsert({
            where: workerId ? { workerId } : { userId: userId! },
            create: {
                ...parsed.data,
                workerId: workerId ?? undefined,
                userId: userId ?? undefined,
            },
            update: parsed.data,
            include: QUALIFICATIONS_INCLUDE,
        });

        return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('安全プロフィール保存', error);
    }
}
