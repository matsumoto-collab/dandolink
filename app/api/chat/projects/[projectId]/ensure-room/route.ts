import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse } from '@/lib/api/utils';

/**
 * POST /api/chat/projects/[projectId]/ensure-room
 * body: { memberIds?: string[] }
 *
 * 案件専用チャットルームを取得 or 作成。
 *  - 既存があればそれを返す（不足メンバーは差分追加しない仕様に変更:
 *    新規作成時のメンバー編集を尊重するため）
 *  - 無ければ作成。memberIds が指定されればそれを採用、無ければ
 *    案件の managers + 全アサイン assignedEmployeeId + confirmedWorkerIds
 *    + 全admin + リクエスト元 をデフォルトで参加させる
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
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
                createdBy: true,
            },
        });
        if (!project) return notFoundResponse('案件');

        // 既存ルーム
        const existing = await prisma.chatRoom.findFirst({
            where: { type: 'project', projectMasterId: projectId },
            select: { id: true },
        });
        if (existing) {
            return NextResponse.json({ roomId: existing.id, existing: true });
        }

        // ルーム名
        const projectPart =
            (project.name ? project.name + (project.honorific || '') : '') ||
            project.title;
        const roomName = project.customerShortName
            ? `${project.customerShortName} ${projectPart}`.trim()
            : projectPart;

        // メンバー決定: ボディ指定 or デフォルト
        let body: unknown = null;
        try { body = await req.json(); } catch { /* noop */ }
        const explicit = body && typeof body === 'object' && Array.isArray((body as { memberIds?: unknown }).memberIds)
            ? ((body as { memberIds: unknown[] }).memberIds as unknown[]).filter((x): x is string => typeof x === 'string')
            : null;

        const memberIds = new Set<string>();
        memberIds.add(userId);

        const isPartner = session!.user.role === 'partner' || session!.user.role === 'partner_member';
        if (isPartner) {
            // 協力業者: 「自分 + 案件担当者(managerIds + createdBy)」に強制
            (project.managerIds || []).forEach((id) => memberIds.add(id));
            if (project.createdBy) {
                try {
                    const ids = JSON.parse(project.createdBy);
                    if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && memberIds.add(id));
                    else if (typeof ids === 'string') memberIds.add(ids);
                } catch {
                    memberIds.add(project.createdBy);
                }
            }
        } else if (explicit) {
            explicit.forEach((id) => memberIds.add(id));
        } else {
            (project.managerIds || []).forEach((id) => memberIds.add(id));
            // 案件担当者（createdBy は JSON配列文字列）
            if (project.createdBy) {
                try {
                    const ids = JSON.parse(project.createdBy);
                    if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && memberIds.add(id));
                    else if (typeof ids === 'string') memberIds.add(ids);
                } catch {
                    memberIds.add(project.createdBy);
                }
            }
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
            select: { id: true },
        });
        const validIds = validUsers.map((u) => u.id);

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
