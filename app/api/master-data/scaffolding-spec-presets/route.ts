import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { sanitizePresetSpec } from '@/lib/scaffoldingSpec';

/**
 * GET /api/master-data/scaffolding-spec-presets
 * 自分のテンプレート＋全社共有（ownerId=null）を返す。他人専用のテンプレートは返さない。
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const presets = await prisma.scaffoldingSpecPreset.findMany({
            where: {
                isActive: true,
                OR: [{ ownerId: session!.user.id }, { ownerId: null }],
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });

        return NextResponse.json(
            presets.map((p) => ({
                id: p.id,
                name: p.name,
                spec: p.spec,
                shared: p.ownerId === null,
                isOwn: p.ownerId === session!.user.id,
                sortOrder: p.sortOrder,
            })),
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('足場仕様テンプレート一覧取得', error);
    }
}

/**
 * POST /api/master-data/scaffolding-spec-presets
 * body: { name, spec, shared? }
 * shared=true（全社共有）で作れるのは admin/manager のみ。それ以外は自分専用として作る。
 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { name, spec, shared } = await request.json();
        if (typeof name !== 'string' || !name.trim()) return validationErrorResponse('テンプレート名は必須です');
        if (name.trim().length > 60) return validationErrorResponse('テンプレート名は60文字以内で入力してください');

        const cleaned = sanitizePresetSpec(spec);
        if (!cleaned) return validationErrorResponse('仕様の形式が正しくありません');
        if (Object.keys(cleaned).length === 0) {
            return validationErrorResponse('保存する内容がありません。足場仕様を1つ以上選んでください');
        }

        const wantShared = shared === true;
        if (wantShared && !isManagerOrAbove(session!.user)) {
            return errorResponse('全社共有のテンプレートを作成する権限がありません', 403);
        }

        const max = await prisma.scaffoldingSpecPreset.aggregate({ _max: { sortOrder: true } });
        const preset = await prisma.scaffoldingSpecPreset.create({
            data: {
                name: name.trim(),
                spec: cleaned,
                ownerId: wantShared ? null : session!.user.id,
                createdById: session!.user.id,
                sortOrder: (max._max.sortOrder ?? -1) + 1,
            },
        });

        return NextResponse.json(
            {
                id: preset.id,
                name: preset.name,
                spec: preset.spec,
                shared: preset.ownerId === null,
                isOwn: preset.ownerId === session!.user.id,
                sortOrder: preset.sortOrder,
            },
            { status: 201 },
        );
    } catch (error) {
        return serverErrorResponse('足場仕様テンプレート作成', error);
    }
}
