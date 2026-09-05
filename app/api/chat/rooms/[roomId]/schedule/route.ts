import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, notFoundResponse, errorResponse } from '@/lib/api/utils';
import { jstDayStartUtc } from '@/lib/dateUtils';

/** ルーム参加者チェック（[roomId]/route.ts と同じ方法） */
async function ensureMember(roomId: string, userId: string) {
    const m = await prisma.chatMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
    });
    return m && !m.leftAt ? m : null;
}

/** ProjectAssignment.date（JST0時＝UTC前日15時）から JST の YYYY-MM-DD を作る */
function toJstDateKey(d: Date): string {
    return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * GET /api/chat/rooms/[roomId]/schedule
 * 案件チャットのヘッダー「予定」ボタン用。このルームの案件に紐づく配置（予定）を返す。
 * 「この現場空けれますか？」の確認時に、その予定へ飛ぶためのリンク元データ。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        // 協力業者は週間カレンダーを持たないので予定一覧も出さない
        const role = (session!.user.role ?? '').toLowerCase();
        if (role === 'partner' || role === 'partner_member') {
            return errorResponse('権限がありません', 403);
        }

        const member = await ensureMember(roomId, userId);
        if (!member) return errorResponse('このルームにアクセスする権限がありません', 403);

        const room = await prisma.chatRoom.findUnique({
            where: { id: roomId },
            select: { type: true, projectMasterId: true },
        });
        if (!room) return notFoundResponse('チャットルーム');
        if (room.type !== 'project' || !room.projectMasterId) {
            return errorResponse('案件チャットではありません', 400);
        }

        // 30日前（JST日の0時＝UTC前日15時）以降の配置だけを対象にする
        const todayStart = jstDayStartUtc(new Date());
        const from = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

        const assignments = await prisma.projectAssignment.findMany({
            where: { projectMasterId: room.projectMasterId, date: { gte: from } },
            orderBy: { date: 'asc' },
            take: 100,
            select: {
                id: true,
                date: true,
                assignedEmployeeId: true,
                memberCount: true,
                estimatedHours: true,
                constructionType: true,
                isDispatchConfirmed: true,
                dateStatus: true,
                meetingTime: true,
            },
        });

        // 職長名（'unassigned' は未定）
        const employeeIds = Array.from(
            new Set(assignments.map((a) => a.assignedEmployeeId).filter((id) => id && id !== 'unassigned'))
        );
        const users = employeeIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: employeeIds } },
                select: { id: true, displayName: true },
            })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u.displayName]));

        // 工事種別（UUIDマスタ。旧データは名前がそのまま入っているので引けなければ素通し）
        const typeKeys = Array.from(
            new Set(assignments.map((a) => a.constructionType).filter((v): v is string => !!v))
        );
        const types = typeKeys.length > 0
            ? await prisma.constructionType.findMany({
                where: { id: { in: typeKeys } },
                select: { id: true, name: true },
            })
            : [];
        const typeMap = new Map(types.map((t) => [t.id, t.name]));

        const items = assignments.map((a) => ({
            id: a.id,
            dateKey: toJstDateKey(a.date),
            foremanName:
                a.assignedEmployeeId && a.assignedEmployeeId !== 'unassigned'
                    ? (userMap.get(a.assignedEmployeeId) ?? '(不明)')
                    : '未定',
            memberCount: a.memberCount,
            estimatedHours: a.estimatedHours,
            constructionTypeName: a.constructionType
                ? (typeMap.get(a.constructionType) ?? a.constructionType)
                : null,
            isDispatchConfirmed: a.isDispatchConfirmed,
            isTentative: a.dateStatus === 'tentative',
            meetingTime: a.meetingTime,
        }));

        return NextResponse.json(
            {
                projectMasterId: room.projectMasterId,
                todayKey: toJstDateKey(todayStart),
                items,
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('案件チャットの予定取得', error);
    }
}
