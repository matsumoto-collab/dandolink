import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse } from '@/lib/api/utils';

/**
 * POST /api/chat/projects/[projectId]/ensure-room
 *
 * 案件専用チャットルーム（type='project'）を冪等で作成・取得する。
 *  - 既存ルームがあればそれを返す
 *  - 無ければ新規作成し、初期メンバーとして
 *      - 案件マスタの managers
 *      - 全アサインの confirmedWorkerIds（手配確定メンバー）
 *      - 全 admin
 *      - リクエスト元
 *    を参加させる
 *  - 既存ルームの場合は不足メンバーを追加（手配確定メンバーが後から増えた場合に追従）
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userId = session!.user.id;
        const { projectId } = await params;

        const project = await prisma.projectMaster.findUnique({
            where: { id: projectId },
            select: {
                id: true,
                title: true,
                name: true,
                honorific: true,
                customerShortName: true,
                managerIds: true,
            },
        });
        if (!project) return notFoundResponse('案件');

        // ルーム名（顧客略称 案件名）
        const projectPart =
            (project.name ? project.name + (project.honorific || '') : '') ||
            project.title;
        const roomName = project.customerShortName
            ? `${project.customerShortName} ${projectPart}`.trim()
            : projectPart;

        // 期待メンバーIDを集める
        const memberIds = new Set<string>();
        memberIds.add(userId);
        (project.managerIds || []).forEach((id) => memberIds.add(id));

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

        // 有効ユーザーのみに絞る
        const validUsers = await prisma.user.findMany({
            where: { id: { in: Array.from(memberIds) }, isActive: true },
            select: { id: true },
        });
        const validIds = validUsers.map((u) => u.id);

        // 既存ルーム
        const existing = await prisma.chatRoom.findFirst({
            where: { type: 'project', projectMasterId: projectId },
            include: { members: true },
        });

        if (existing) {
            const currentMemberIds = new Set(
                existing.members.filter((m) => !m.leftAt).map((m) => m.userId)
            );
            const toAdd = validIds.filter((id) => !currentMemberIds.has(id));
            if (toAdd.length > 0) {
                await prisma.$transaction(
                    toAdd.map((id) =>
                        prisma.chatMember.upsert({
                            where: { roomId_userId: { roomId: existing.id, userId: id } },
                            create: { roomId: existing.id, userId: id, role: 'member' },
                            update: { leftAt: null },
                        })
                    )
                );
            }
            return NextResponse.json({ roomId: existing.id, existing: true });
        }

        const room = await prisma.chatRoom.create({
            data: {
                type: 'project',
                name: roomName,
                projectMasterId: projectId,
                createdBy: userId,
                members: {
                    create: validIds.map((id) => ({
                        userId: id,
                        role: id === userId ? 'owner' : 'member',
                    })),
                },
            },
        });

        return NextResponse.json({ roomId: room.id, existing: false });
    } catch (error) {
        return serverErrorResponse('案件チャットルーム作成', error);
    }
}
