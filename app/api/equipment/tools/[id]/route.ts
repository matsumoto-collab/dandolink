import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { canEditEquipment, describeDeleteBlockers, toolHardDeleteBlockers } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toAmount = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** 電動工具の基本情報を更新する（持出しの状態は /checkout が担当）。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id } });
        if (!current) return notFoundResponse('電動工具');

        const body = await request.json().catch(() => ({}));
        const data: Record<string, unknown> = {};

        if ('categoryId' in body) {
            const categoryId = str(body.categoryId, 100);
            if (!categoryId) return errorResponse('分類を選んでください', 400);
            const category = await prisma.toolCategory.findUnique({ where: { id: categoryId }, select: { id: true, isActive: true } });
            if (!category) return errorResponse('分類が見つかりません', 400);
            // 一覧から外した分類へは移せない（今その分類にいる工具を、分類を変えずに保存するのは許す）
            if (!category.isActive && categoryId !== current.categoryId) {
                return errorResponse('その分類は一覧から外されています', 400);
            }
            data.categoryId = categoryId;
        }
        if ('name' in body) {
            const name = str(body.name, 100);
            if (!name) return errorResponse('名前（管理番号）を入力してください', 400);
            data.name = name;
        }
        if ('maker' in body) data.maker = str(body.maker, 100);
        if ('modelNumber' in body) data.modelNumber = str(body.modelNumber, 100);
        if ('serialNumber' in body) data.serialNumber = str(body.serialNumber, 100);
        if ('purchaseDate' in body) data.purchaseDate = toDate(body.purchaseDate);
        if ('purchasePrice' in body) data.purchasePrice = toAmount(body.purchasePrice);
        if ('note' in body) data.note = str(body.note, 1000);
        if ('isActive' in body) data.isActive = body.isActive !== false;

        const updated = await prisma.tool.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('電動工具の更新', error);
    }
}

/**
 * 電動工具を台帳から削除する。
 *
 * 既定（?mode 指定なし）は論理削除＝ isActive=false にするだけ。持出しの履歴・整備の履歴・
 * 過去の配置に残る工具名を壊さないため（画面では「使わなくなった工具も表示」で見える）。
 *
 * ?mode=hard は間違えて登録した分の消去用で、記録が1件でも残っているものは 400 で弾く。
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
        if (!current) return notFoundResponse('電動工具');

        const hard = new URL(request.url).searchParams.get('mode') === 'hard';
        if (!hard) {
            await prisma.tool.update({ where: { id }, data: { isActive: false } });
            return deleteSuccessResponse('電動工具');
        }

        // 予定（ProjectAssignment.tools / confirmedToolIds）は Tool.id の JSON 配列を文字列で持っているため、
        // AssignmentTool の行に加えて文字列としても探す（保存経路の取りこぼし対策。ID は uuid なので誤検出しない）。
        const [assignmentToolCount, assignmentJsonCount, checkoutLogCount, maintenanceCount] = await Promise.all([
            prisma.assignmentTool.count({ where: { toolId: id } }),
            prisma.projectAssignment.count({
                where: { OR: [{ tools: { contains: id } }, { confirmedToolIds: { contains: id } }] },
            }),
            prisma.toolCheckoutLog.count({ where: { toolId: id } }),
            prisma.equipmentMaintenanceRecord.count({ where: { targetType: 'tool', targetId: id } }),
        ]);

        const blockers = toolHardDeleteBlockers({
            status: current.status,
            // 同じ配置が両方に出るので多い方を件数とする
            assignmentCount: Math.max(assignmentToolCount, assignmentJsonCount),
            checkoutLogCount,
            maintenanceCount,
        });
        if (blockers.length > 0) {
            return errorResponse(
                `${describeDeleteBlockers(`「${current.name}」`, blockers)}。「台帳から外す」をお使いください`,
                400,
            );
        }

        await prisma.tool.delete({ where: { id } });
        return deleteSuccessResponse('電動工具');
    } catch (error) {
        return serverErrorResponse('電動工具の削除', error);
    }
}
