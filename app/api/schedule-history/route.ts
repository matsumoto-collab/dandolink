import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

/**
 * GET /api/schedule-history - スケジュール変更履歴の取得
 * 閲覧権限: admin / manager のみ
 * 直近 limit 件(デフォルト100、最大500)を新しい順で返す
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const limitRaw = Number(searchParams.get('limit') ?? 100);
        const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
        const q = (searchParams.get('q') ?? '').trim();

        const where = q
            ? {
                  assignment: {
                      projectMaster: {
                          OR: [
                              { name: { contains: q, mode: 'insensitive' as const } },
                              { title: { contains: q, mode: 'insensitive' as const } },
                              { customerName: { contains: q, mode: 'insensitive' as const } },
                          ],
                      },
                  },
              }
            : undefined;

        // 移動（日付/職長）の変更履歴。※配置削除時はカスケードで消えるため、ここに残るのは現存配置のみ。
        const moveHistories = await prisma.scheduleChangeHistory.findMany({
            where,
            orderBy: { changedAt: 'desc' },
            take: limit,
            include: {
                assignment: {
                    include: {
                        projectMaster: {
                            select: {
                                id: true,
                                title: true,
                                name: true,
                                honorific: true,
                                customerName: true,
                            },
                        },
                    },
                },
            },
        });

        // 削除の控え（DeletedAssignmentLog）。配置への FK が無いので projectMaster は別引きする。
        const deleteLogs = await prisma.deletedAssignmentLog.findMany({
            orderBy: { deletedAt: 'desc' },
            take: limit,
        });
        const logPmIds = Array.from(new Set(deleteLogs.map((l) => l.projectMasterId)));
        const logPms = logPmIds.length > 0
            ? await prisma.projectMaster.findMany({
                  where: { id: { in: logPmIds } },
                  select: { id: true, title: true, name: true, honorific: true, customerName: true },
              })
            : [];
        const pmMap = new Map(logPms.map((p) => [p.id, p]));

        // q 指定時は削除控えも案件名（短縮名・正式名・顧客名）でフィルタ
        const ql = q.toLowerCase();
        const filteredLogs = q
            ? deleteLogs.filter((l) => {
                  const pm = pmMap.get(l.projectMasterId);
                  if (!pm) return false;
                  const hay = `${pm.name ?? ''} ${pm.title ?? ''} ${pm.customerName ?? ''}`.toLowerCase();
                  return hay.includes(ql);
              })
            : deleteLogs;

        // 変更者名・職長名を一括解決（移動・削除の両方ぶん）
        const userIds = new Set<string>();
        moveHistories.forEach((h) => {
            userIds.add(h.changedById);
            if (h.changeType === 'foreman') {
                if (h.previousValue) userIds.add(h.previousValue);
                if (h.newValue) userIds.add(h.newValue);
            }
        });
        const logSnapshots = new Map<string, { date?: string; assignedEmployeeId?: string }>();
        filteredLogs.forEach((l) => {
            userIds.add(l.deletedById);
            if (l.restoredById) userIds.add(l.restoredById);
            try {
                const snap = JSON.parse(l.snapshot) as { date?: string; assignedEmployeeId?: string };
                logSnapshots.set(l.id, snap);
                if (snap.assignedEmployeeId) userIds.add(snap.assignedEmployeeId);
            } catch {
                // snapshot が壊れていても他の項目は表示できるよう握りつぶす
            }
        });
        const users = await prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, displayName: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u.displayName]));

        // 移動エントリ
        const moveEntries = moveHistories.map((h) => ({
            id: h.id,
            kind: 'move' as const,
            historyId: h.id,
            assignmentId: h.assignmentId,
            changedAt: h.changedAt.toISOString(),
            changeType: h.changeType,
            previousValue: h.previousValue,
            newValue: h.newValue,
            changedBy: {
                id: h.changedById,
                displayName: userMap.get(h.changedById) ?? '(不明)',
            },
            previousLabel:
                h.changeType === 'foreman'
                    ? userMap.get(h.previousValue) ?? '(不明)'
                    : null,
            newLabel:
                h.changeType === 'foreman'
                    ? userMap.get(h.newValue) ?? '(不明)'
                    : null,
            project: h.assignment?.projectMaster
                ? {
                      id: h.assignment.projectMaster.id,
                      title: h.assignment.projectMaster.title,
                      name: h.assignment.projectMaster.name,
                      honorific: h.assignment.projectMaster.honorific,
                      customerName: h.assignment.projectMaster.customerName,
                  }
                : null,
        }));

        // 削除エントリ
        const deleteEntries = filteredLogs.map((l) => {
            const pm = pmMap.get(l.projectMasterId) ?? null;
            const snap = logSnapshots.get(l.id);
            return {
                id: l.id,
                kind: 'delete' as const,
                logId: l.id,
                changedAt: l.deletedAt.toISOString(),
                changeType: 'delete' as const,
                changedBy: {
                    id: l.deletedById,
                    displayName: userMap.get(l.deletedById) ?? '(不明)',
                },
                project: pm
                    ? {
                          id: pm.id,
                          title: pm.title,
                          name: pm.name,
                          honorific: pm.honorific,
                          customerName: pm.customerName,
                      }
                    : null,
                deletedDate: snap?.date ?? null,
                deletedForemanName: snap?.assignedEmployeeId
                    ? userMap.get(snap.assignedEmployeeId) ?? null
                    : null,
                restored: !!l.restoredAt,
                restoredAt: l.restoredAt ? l.restoredAt.toISOString() : null,
                restoredBy: l.restoredById ? userMap.get(l.restoredById) ?? null : null,
            };
        });

        // マージして発生時刻の降順、先頭 limit 件
        const merged = [...moveEntries, ...deleteEntries]
            .sort((a, b) => (a.changedAt < b.changedAt ? 1 : a.changedAt > b.changedAt ? -1 : 0))
            .slice(0, limit);

        return NextResponse.json(
            { histories: merged },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('スケジュール変更履歴の取得', error);
    }
}
