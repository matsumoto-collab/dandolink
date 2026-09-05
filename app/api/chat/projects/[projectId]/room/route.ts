import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse } from '@/lib/api/utils';

/**
 * GET /api/chat/projects/[projectId]/room
 *
 * 案件チャットの状態を返す。
 *  - 既存ルームがあれば { roomId, members: [...] }
 *  - 無ければ { roomId: null, suggestedMemberIds: [...], defaultSelectedIds: [...], members: [...] }
 *      suggested は managerIds + 全アサイン assignedEmployeeId + confirmedWorkerIds
 *      + 全admin + 自分。候補一覧として画面に並べる。
 *      defaultSelectedIds は初期チェック状態。編集できる人（協力業者以外）は
 *      「自分だけ」＝呼びたい人を毎回明示的に選ぶ運用（kei指示 2026-09-05）。
 *      協力業者はメンバーを編集できないので候補全員のまま。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userId = session!.user.id;
        const { projectId } = await params;

        const project = await prisma.projectMaster.findUnique({
            where: { id: projectId },
            select: { id: true, managerIds: true, createdBy: true },
        });
        if (!project) return notFoundResponse('案件');

        const existing = await prisma.chatRoom.findFirst({
            where: { type: 'project', projectMasterId: projectId },
            include: { members: { where: { leftAt: null } } },
        });

        if (existing) {
            const userIds = existing.members.map((m) => m.userId);
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, displayName: true, role: true },
            });
            const userMap = new Map(users.map((u) => [u.id, u]));
            return NextResponse.json({
                roomId: existing.id,
                members: existing.members.map((m) => ({
                    userId: m.userId,
                    displayName: userMap.get(m.userId)?.displayName ?? '(不明)',
                    role: userMap.get(m.userId)?.role ?? null,
                })),
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        // 推奨メンバー算出
        const memberIds = new Set<string>();
        memberIds.add(userId);
        (project.managerIds || []).forEach((id) => memberIds.add(id));
        // 案件担当者（createdBy は JSON文字列の配列で保存される）
        if (project.createdBy) {
            try {
                const ids = JSON.parse(project.createdBy);
                if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && memberIds.add(id));
                else if (typeof ids === 'string') memberIds.add(ids);
            } catch {
                memberIds.add(project.createdBy);
            }
        }

        // 協力業者は「自分 + 案件担当者(createdBy/managerIds)」のみ。
        // 職長/確定メンバー/admin は含めない
        const isPartner = session!.user.role === 'partner' || session!.user.role === 'partner_member';
        if (!isPartner) {
            const assignments = await prisma.projectAssignment.findMany({
                where: { projectMasterId: projectId },
                select: { assignedEmployeeId: true, confirmedWorkerIds: true },
            });
            for (const a of assignments) {
                if (a.assignedEmployeeId) memberIds.add(a.assignedEmployeeId);
                if (a.confirmedWorkerIds) {
                    try {
                        const ids = JSON.parse(a.confirmedWorkerIds);
                        if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && memberIds.add(id));
                    } catch { /* noop */ }
                }
            }
            const admins = await prisma.user.findMany({
                where: { role: 'admin', isActive: true },
                select: { id: true },
            });
            admins.forEach((u) => memberIds.add(u.id));
        }

        const validUsers = await prisma.user.findMany({
            where: { id: { in: Array.from(memberIds) }, isActive: true },
            select: { id: true, displayName: true, role: true },
        });

        // 自分を先頭に並べる（初期状態で唯一チェックが付いている行が一番上に来る）
        validUsers.sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : 0));
        const suggestedMemberIds = validUsers.map((u) => u.id);

        return NextResponse.json({
            roomId: null,
            canEditMembers: !isPartner,
            selfUserId: userId,
            suggestedMemberIds,
            defaultSelectedIds: isPartner ? suggestedMemberIds : suggestedMemberIds.filter((id) => id === userId),
            members: validUsers.map((u) => ({
                userId: u.id,
                displayName: u.displayName,
                role: u.role,
            })),
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('案件チャット状態取得', error);
    }
}
