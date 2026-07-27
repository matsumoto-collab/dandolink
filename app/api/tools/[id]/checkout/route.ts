import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { resolveProjectNames, resolveUserNames } from '@/lib/tools/names';
import { isToolStatus, type ToolLogAction } from '@/types/tool';

interface RouteContext { params: Promise<{ id: string }>; }

// 持出し・返却・状態変更は社員のみ。
// 協力会社（partner / partner_member）は閲覧専用、税理士（accountant）は業務外のため除外する。
const EMPLOYEE_ROLES = ['admin', 'manager', 'foreman1', 'foreman2', 'worker'];

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role || '').toLowerCase();
        if (!EMPLOYEE_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;
        const body = await request.json();
        const { status, projectMasterId, destinationNote, holderId, note } = body;

        if (!isToolStatus(status)) return errorResponse('状態が不正です', 400);

        const tool = await prisma.tool.findUnique({ where: { id } });
        if (!tool || !tool.isActive) return errorResponse('工具が見つかりません', 404);

        const trimmedDestination = typeof destinationNote === 'string' ? destinationNote.trim() : '';
        const isCheckedOut = status === 'checked_out';

        // 持出中は「どこへ・誰が」が無いと台帳として機能しないため必須
        if (isCheckedOut) {
            if (!projectMasterId && !trimmedDestination) return errorResponse('持出し先を指定してください', 400);
            if (!holderId) return errorResponse('持出者を指定してください', 400);
        }

        // 持出中以外（社内保管・修理・紛失・廃棄）は持出し情報を持たない
        const nextProjectMasterId = isCheckedOut && projectMasterId ? String(projectMasterId) : null;
        const nextDestinationNote = isCheckedOut && trimmedDestination ? trimmedDestination : null;
        const nextHolderId = isCheckedOut ? String(holderId) : null;

        // 持出し先か持出者が変われば「新しい持出し」なので持出日を打ち直す
        const destinationChanged = tool.projectMasterId !== nextProjectMasterId || tool.destinationNote !== nextDestinationNote;
        const holderChanged = tool.holderId !== nextHolderId;
        const keepCheckedOutAt = isCheckedOut && tool.status === 'checked_out' && !destinationChanged && !holderChanged;
        const nextCheckedOutAt = isCheckedOut ? (keepCheckedOutAt ? tool.checkedOutAt : new Date()) : null;

        const action: ToolLogAction = isCheckedOut
            ? 'checkout'
            : tool.status === 'checked_out' && status === 'in_stock'
                ? 'return'
                : 'status_change';

        // 履歴には当時の名前を残す（案件が消えても・改名されても履歴が読めるように）
        const [projectNames, userNames] = await Promise.all([
            resolveProjectNames([nextProjectMasterId]),
            resolveUserNames([nextHolderId, session!.user.id]),
        ]);
        const holderName = nextHolderId ? userNames.get(nextHolderId) ?? null : null;
        const nextNote = typeof note === 'string' && note.trim() ? note.trim() : null;

        const [updated] = await prisma.$transaction([
            prisma.tool.update({
                where: { id },
                data: {
                    status,
                    projectMasterId: nextProjectMasterId,
                    destinationNote: nextDestinationNote,
                    holderId: nextHolderId,
                    checkedOutAt: nextCheckedOutAt,
                    note: nextNote,
                },
                include: { category: { select: { name: true } } },
            }),
            prisma.toolCheckoutLog.create({
                data: {
                    toolId: id,
                    action,
                    status,
                    projectMasterId: nextProjectMasterId,
                    projectName: nextProjectMasterId ? projectNames.get(nextProjectMasterId) ?? null : null,
                    destinationNote: nextDestinationNote,
                    holderId: nextHolderId,
                    holderName,
                    note: nextNote,
                    createdBy: session!.user.id,
                    createdByName: userNames.get(session!.user.id) ?? session!.user.name ?? null,
                },
            }),
        ]);

        const { category, ...rest } = updated;
        return NextResponse.json({
            ...rest,
            categoryName: category.name,
            projectName: nextProjectMasterId ? projectNames.get(nextProjectMasterId) ?? null : null,
            holderName,
        });
    } catch (error) {
        return serverErrorResponse('工具の状態更新', error);
    }
}
