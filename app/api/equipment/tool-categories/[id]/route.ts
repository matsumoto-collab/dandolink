import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import {
    canEditEquipment,
    describeDeleteBlockers,
    toolCategoryHardDeleteBlockers,
    toolCategorySoftDeleteBlockers,
} from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

/** 分類の名前変更と、一覧から外した分類を戻す（isActive）。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.toolCategory.findUnique({ where: { id }, select: { id: true } });
        if (!current) return notFoundResponse('工具の分類');

        const body = await request.json().catch(() => ({}));
        const data: { name?: string; isActive?: boolean } = {};

        if ('name' in body) {
            const name = String(body.name ?? '').trim();
            if (!name) return errorResponse('分類名を入力してください', 400);
            data.name = name.slice(0, 100);
        }
        if ('isActive' in body) data.isActive = body.isActive !== false;

        const updated = await prisma.toolCategory.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('工具の分類の更新', error);
    }
}

/**
 * 工具の分類を削除する。
 *
 * 既定は論理削除＝ isActive=false（一覧・選択肢から消えるだけ。外した工具の分類名は残る）。
 * ?mode=hard は物理削除で、Tool.categoryId は必須なので工具が1台でも属していたら 400 で弾く。
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.toolCategory.findUnique({ where: { id }, select: { id: true, name: true } });
        if (!current) return notFoundResponse('工具の分類');

        const [activeToolCount, inactiveToolCount] = await Promise.all([
            prisma.tool.count({ where: { categoryId: id, isActive: true } }),
            prisma.tool.count({ where: { categoryId: id, isActive: false } }),
        ]);
        const counts = { activeToolCount, inactiveToolCount };

        const hard = new URL(request.url).searchParams.get('mode') === 'hard';
        const blockers = hard ? toolCategoryHardDeleteBlockers(counts) : toolCategorySoftDeleteBlockers(counts);
        if (blockers.length > 0) {
            const subject = `分類「${current.name}」`;
            const message = hard
                ? `${describeDeleteBlockers(subject, blockers)}。先に工具を完全に削除するか、別の分類へ移してください`
                : `${describeDeleteBlockers(subject, blockers, '一覧から外せません')}。先に工具を台帳から外してください`;
            return errorResponse(message, 400);
        }

        if (hard) {
            await prisma.toolCategory.delete({ where: { id } });
        } else {
            await prisma.toolCategory.update({ where: { id }, data: { isActive: false } });
        }
        return deleteSuccessResponse('工具の分類');
    } catch (error) {
        return serverErrorResponse('工具の分類の削除', error);
    }
}
