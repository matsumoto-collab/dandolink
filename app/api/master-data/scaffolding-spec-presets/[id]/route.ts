import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse, notFoundResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { sanitizePresetSpec } from '@/lib/scaffoldingSpec';

interface RouteContext { params: Promise<{ id: string }>; }

/**
 * 自分専用テンプレートは本人のみ、全社共有は admin/manager のみ編集・削除できる。
 * （admin/manager は他人の専用テンプレートには触れない＝担当者の持ち物として扱う）
 */
function canModify(
    preset: { ownerId: string | null },
    user: { id: string; role: string; isActive: boolean },
): boolean {
    if (preset.ownerId === null) return isManagerOrAbove(user);
    return preset.ownerId === user.id;
}

/** PATCH /api/master-data/scaffolding-spec-presets/[id] — 名前 / 内容 / 並び順の更新。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const existing = await prisma.scaffoldingSpecPreset.findUnique({ where: { id } });
        if (!existing || !existing.isActive) return notFoundResponse('足場仕様テンプレート');
        if (!canModify(existing, session!.user)) return errorResponse('権限がありません', 403);

        const { name, spec, sortOrder } = await request.json();
        const updateData: { name?: string; spec?: Record<string, boolean | string>; sortOrder?: number } = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) return validationErrorResponse('テンプレート名は必須です');
            if (name.trim().length > 60) return validationErrorResponse('テンプレート名は60文字以内で入力してください');
            updateData.name = name.trim();
        }
        if (spec !== undefined) {
            const cleaned = sanitizePresetSpec(spec);
            if (!cleaned) return validationErrorResponse('仕様の形式が正しくありません');
            if (Object.keys(cleaned).length === 0) {
                return validationErrorResponse('保存する内容がありません。足場仕様を1つ以上選んでください');
            }
            updateData.spec = cleaned;
        }
        if (sortOrder !== undefined) {
            if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
                return validationErrorResponse('並び順は数値で指定してください');
            }
            updateData.sortOrder = sortOrder;
        }

        const preset = await prisma.scaffoldingSpecPreset.update({ where: { id }, data: updateData });
        return NextResponse.json({
            id: preset.id,
            name: preset.name,
            spec: preset.spec,
            shared: preset.ownerId === null,
            isOwn: preset.ownerId === session!.user.id,
            sortOrder: preset.sortOrder,
        });
    } catch (error) {
        return serverErrorResponse('足場仕様テンプレート更新', error);
    }
}

/** DELETE /api/master-data/scaffolding-spec-presets/[id] — 論理削除（他マスタに合わせて isActive=false）。 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const existing = await prisma.scaffoldingSpecPreset.findUnique({ where: { id } });
        if (!existing || !existing.isActive) return notFoundResponse('足場仕様テンプレート');
        if (!canModify(existing, session!.user)) return errorResponse('権限がありません', 403);

        await prisma.scaffoldingSpecPreset.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('足場仕様テンプレート削除', error);
    }
}
