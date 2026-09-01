import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canEditEquipment, isToolStatus } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

/**
 * 電動工具の持出し・返却・状態変更を記録する。
 * 「その当時、誰が使っていたか」を残すのが目的なので、案件名・氏名は当時のままの
 * スナップショットで ToolCheckoutLog に書く（工具側は現在の状態だけを持つ）。
 */
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const tool = await prisma.tool.findUnique({ where: { id } });
        if (!tool) return notFoundResponse('電動工具');

        const body = await request.json().catch(() => ({}));
        const action = String(body.action ?? '');
        if (!['checkout', 'return', 'status_change'].includes(action)) {
            return errorResponse('操作の種類が不正です', 400);
        }

        const note = str(body.note, 500);
        let status: string;
        let holderId: string | null = null;
        let holderName: string | null = null;
        let projectMasterId: string | null = null;
        let projectName: string | null = null;
        let destinationNote: string | null = null;

        if (action === 'checkout') {
            holderId = str(body.holderId, 100);
            holderName = str(body.holderName, 100);
            projectMasterId = str(body.projectMasterId, 100);
            destinationNote = str(body.destinationNote, 200);
            if (!holderId && !holderName) return errorResponse('使用者を選ぶか入力してください', 400);

            // 選んだユーザーの表示名を当時の記録として残す
            if (holderId) {
                const user = await prisma.user.findUnique({ where: { id: holderId }, select: { displayName: true } });
                if (!user) return errorResponse('使用者が見つかりません', 400);
                holderName = user.displayName;
            }
            if (projectMasterId) {
                const pm = await prisma.projectMaster.findUnique({ where: { id: projectMasterId }, select: { name: true, title: true } });
                if (!pm) return errorResponse('案件が見つかりません', 400);
                projectName = pm.name || pm.title;
            }
            status = 'checked_out';
        } else if (action === 'return') {
            status = 'in_stock';
        } else {
            if (!isToolStatus(body.status)) return errorResponse('状態が不正です', 400);
            status = body.status;
            // 持出中のまま状態だけ変えるケース（修理へ直行など）は現在の持出者を引き継ぐ
            if (status === 'checked_out') return errorResponse('持出しは「持ち出す」から記録してください', 400);
        }

        const [updated] = await prisma.$transaction([
            prisma.tool.update({
                where: { id },
                data: {
                    status,
                    holderId,
                    projectMasterId,
                    destinationNote,
                    checkedOutAt: action === 'checkout' ? new Date() : null,
                },
            }),
            prisma.toolCheckoutLog.create({
                data: {
                    toolId: id,
                    action,
                    status,
                    projectMasterId,
                    projectName,
                    destinationNote,
                    holderId,
                    holderName,
                    note,
                    createdBy: session!.user.id,
                    createdByName: session!.user.name ?? null,
                },
            }),
        ]);

        return NextResponse.json(updated, { status: 201 });
    } catch (error) {
        return serverErrorResponse('使用記録の保存', error);
    }
}
