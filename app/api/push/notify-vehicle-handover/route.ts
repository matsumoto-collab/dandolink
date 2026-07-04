import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { notifyUsers } from '@/lib/notifications';
import { parseJsonField } from '@/lib/json-utils';
import {
    buildDesiredHandoverPairs,
    diffHandovers,
    type HandoverPair,
    type TargetInfo,
} from '@/lib/vehicleHandoverDiff';
import type { VehicleUsage } from '@/lib/vehicleHandover';

/**
 * 車両引き継ぎ通知（協力業者車両_閲覧権限と引き継ぎ通知_実装指示.md §4-2 / §4-3）。
 *
 * クライアント（DispatchConfirmModal）から確定／解除直後に呼ばれる。
 * 引き継ぎペアの「いまあるべき集合」を再計算し、VehicleHandoverNotice 表との差分で
 * 追加（送信＋INSERT）／削除（取消通知＋canceledAt セット）を行う。
 *
 * 過去情報の誤通知ガード:
 *   - diff の対象は「入力手配日 ±30日」の窓内で完結する行のみ。desired 側は窓内の
 *     候補からしか構築できないため、窓外の行まで比べると実態不変でも removed になる。
 *   - 引き継ぎ日（to 側の使用日）が今日(JST)より前のペアは、追加・取消とも
 *     テーブルへの記録だけ行い、通知は送らない。
 */

const bodySchema = z.object({
    assignmentIds: z.array(z.string().min(1)).min(1).max(50),
    mode: z.enum(['confirm', 'cancel']),
});

const SEARCH_RANGE_DAYS = 30;

/** JST で日付キー (YYYY-MM-DD) を取り出す。サーバ TZ に依存しない。 */
function dateKeyJst(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Tokyo',
    }).format(date);
}

/** JST で日本語短表記 (M/D(曜)) に整形する。 */
function formatJpShortDate(date: Date): string {
    return new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'Asia/Tokyo',
    }).format(date);
}

function parseStringArray(value: string | null | undefined): string[] {
    const v = parseJsonField<unknown>(value, null);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const raw = await request.json().catch(() => ({}));
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }
        const { assignmentIds, mode } = parsed.data;

        // === 1. 入力 assignment の現在状態を取得 ===
        const inputAssignments = await prisma.projectAssignment.findMany({
            where: { id: { in: assignmentIds } },
            select: {
                id: true,
                assignedEmployeeId: true,
                date: true,
                confirmedVehicleIds: true,
                isDispatchConfirmed: true,
            },
        });
        if (inputAssignments.length === 0) {
            return NextResponse.json({ mode, added: 0, removed: 0, reason: 'no-assignment' });
        }

        // === 2. 影響範囲の車両 ID を特定 ===
        // confirm: 入力 assignment の confirmedVehicleIds から
        // cancel:  既存の有効 VehicleHandoverNotice に登場する row から逆引き
        //          （cancel 時は入力 assignment の confirmedVehicleIds が空になっている可能性が高い）
        const vehicleIdSet = new Set<string>();
        for (const a of inputAssignments) {
            for (const v of parseStringArray(a.confirmedVehicleIds)) vehicleIdSet.add(v);
        }
        const noticesByInput = await prisma.vehicleHandoverNotice.findMany({
            where: {
                canceledAt: null,
                OR: [
                    { fromAssignmentId: { in: assignmentIds } },
                    { toAssignmentId: { in: assignmentIds } },
                ],
            },
            select: { vehicleId: true },
        });
        for (const n of noticesByInput) vehicleIdSet.add(n.vehicleId);

        if (vehicleIdSet.size === 0) {
            return NextResponse.json({ mode, added: 0, removed: 0, reason: 'no-affected-vehicle' });
        }

        // === 3. 影響範囲（前後30日）の confirmed assignment 候補を取得 ===
        const inputTimes = inputAssignments.map(a => a.date.getTime());
        const minTime = Math.min(...inputTimes);
        const maxTime = Math.max(...inputTimes);
        const rangeStart = new Date(minTime - SEARCH_RANGE_DAYS * 24 * 60 * 60 * 1000);
        const rangeEnd = new Date(maxTime + (SEARCH_RANGE_DAYS + 1) * 24 * 60 * 60 * 1000);

        const candidates = await prisma.projectAssignment.findMany({
            where: {
                isDispatchConfirmed: true,
                date: { gte: rangeStart, lt: rangeEnd },
            },
            select: {
                id: true,
                assignedEmployeeId: true,
                date: true,
                confirmedVehicleIds: true,
                confirmedWorkerIds: true,
            },
        });

        // === 4. VehicleUsage / workersByAssignment / targets を構築 ===
        const allUsages: VehicleUsage[] = [];
        const workersByAssignment = new Map<string, string[]>();
        const targetByAssignment = new Map<string, TargetInfo>();

        for (const a of candidates) {
            workersByAssignment.set(a.id, parseStringArray(a.confirmedWorkerIds));

            const vehicleIds = parseStringArray(a.confirmedVehicleIds).filter(v => vehicleIdSet.has(v));
            if (vehicleIds.length === 0) continue;

            const dateKey = dateKeyJst(a.date);
            for (const v of vehicleIds) {
                allUsages.push({
                    assignmentId: a.id,
                    teamId: a.assignedEmployeeId,
                    dateKey,
                    vehicleId: v,
                });
            }
            const t = targetByAssignment.get(a.id);
            if (t) {
                t.vehicleIds.push(...vehicleIds);
            } else {
                targetByAssignment.set(a.id, {
                    assignmentId: a.id,
                    teamId: a.assignedEmployeeId,
                    dateKey,
                    vehicleIds: [...vehicleIds],
                });
            }
        }
        const targets = Array.from(targetByAssignment.values());

        // === 5. desired pair 集合を構築 ===
        const desired = buildDesiredHandoverPairs(targets, allUsages, workersByAssignment, {
            searchRangeDays: SEARCH_RANGE_DAYS,
        });

        // === 6. existing pair 集合（有効なもの）を取得 ===
        const existingRows = await prisma.vehicleHandoverNotice.findMany({
            where: {
                canceledAt: null,
                vehicleId: { in: Array.from(vehicleIdSet) },
            },
            select: {
                id: true,
                vehicleId: true,
                fromAssignmentId: true,
                toAssignmentId: true,
                notifiedUserIds: true,
            },
        });

        // === 6-2. diff の対象を desired と同じ「±30日窓」に揃える ===
        // desired は窓内の候補からしか構築できない。窓外の行まで diff に入れると、
        // 実態が変わっていないのに毎回 removed 判定され、過去の引き継ぎに取消通知が
        // 飛んでしまう。窓外の行には触らない。参照先の手配が削除済みの行だけは、
        // desired に二度と現れず永遠に残るため、通知なしで無効化する。
        const dateByAssignmentId = new Map<string, Date>();
        for (const a of candidates) dateByAssignmentId.set(a.id, a.date);
        const unresolvedIds = new Set<string>();
        for (const r of existingRows) {
            if (!dateByAssignmentId.has(r.fromAssignmentId)) unresolvedIds.add(r.fromAssignmentId);
            if (!dateByAssignmentId.has(r.toAssignmentId)) unresolvedIds.add(r.toAssignmentId);
        }
        if (unresolvedIds.size > 0) {
            // 候補外（確定解除直後の入力手配・窓外の手配など）でも、手配が残っていれば日付は解決できる
            const extra = await prisma.projectAssignment.findMany({
                where: { id: { in: Array.from(unresolvedIds) } },
                select: { id: true, date: true },
            });
            for (const a of extra) dateByAssignmentId.set(a.id, a.date);
        }
        const inRange = (d: Date) =>
            d.getTime() >= rangeStart.getTime() && d.getTime() < rangeEnd.getTime();

        const orphanRowIds: string[] = [];
        const diffableRows: typeof existingRows = [];
        for (const r of existingRows) {
            const fromDate = dateByAssignmentId.get(r.fromAssignmentId);
            const toDate = dateByAssignmentId.get(r.toAssignmentId);
            if (!fromDate || !toDate) {
                orphanRowIds.push(r.id);
                continue;
            }
            if (!inRange(fromDate) || !inRange(toDate)) continue;
            diffableRows.push(r);
        }
        if (orphanRowIds.length > 0) {
            await prisma.vehicleHandoverNotice.updateMany({
                where: { id: { in: orphanRowIds } },
                data: { canceledAt: new Date() },
            });
        }

        const existingPairs: HandoverPair[] = diffableRows.map(r => ({
            vehicleId: r.vehicleId,
            fromAssignmentId: r.fromAssignmentId,
            toAssignmentId: r.toAssignmentId,
            notifiedUserIds: parseStringArray(r.notifiedUserIds),
        }));

        // === 7. diff ===
        const { added, removed } = diffHandovers(desired, existingPairs);
        if (added.length === 0 && removed.length === 0) {
            return NextResponse.json({ mode, added: 0, removed: 0, orphanedRows: orphanRowIds.length });
        }

        // === 8. 通知本文に必要なマスタを取得 ===
        const involvedAssignmentIds = new Set<string>();
        const involvedVehicleIds = new Set<string>();
        for (const p of [...added, ...removed]) {
            involvedAssignmentIds.add(p.fromAssignmentId);
            involvedAssignmentIds.add(p.toAssignmentId);
            involvedVehicleIds.add(p.vehicleId);
        }
        const [involvedAssignments, vehicles] = await Promise.all([
            prisma.projectAssignment.findMany({
                where: { id: { in: Array.from(involvedAssignmentIds) } },
                select: { id: true, assignedEmployeeId: true, date: true },
            }),
            prisma.vehicle.findMany({
                where: { id: { in: Array.from(involvedVehicleIds) } },
                select: { id: true, name: true },
            }),
        ]);
        const assignmentById = new Map(involvedAssignments.map(a => [a.id, a]));
        const vehicleById = new Map(vehicles.map(v => [v.id, v]));

        const foremanIds = new Set<string>();
        for (const a of involvedAssignments) foremanIds.add(a.assignedEmployeeId);
        const foremen = await prisma.user.findMany({
            where: { id: { in: Array.from(foremanIds) } },
            select: { id: true, displayName: true },
        });
        const foremanById = new Map(foremen.map(f => [f.id, f]));

        const formatVehicleList = (vIds: string[]) =>
            vIds.map(id => vehicleById.get(id)?.name ?? '車両').join('・');

        // 引き継ぎ日（to 側の使用日）が今日(JST)より前のペアは通知しない。
        // 過去日の手配を後から確定・解除したときに、済んだ引き継ぎの案内や取消が
        // 今さら届くのを防ぐ。テーブルへの記録は行い、差分の収束は保つ。
        const todayKey = dateKeyJst(new Date());

        // === 9. added: (fromAssignmentId, toAssignmentId) 単位で集約 → 1通 ===
        // §I: 多車両は本文に「軽トラ①・ダンプ②」と連結
        // §H: 本文は「車両＋班＋日付」のみ
        type AddedGroup = { pair: HandoverPair; vehicleIds: string[]; userIds: Set<string> };
        const addedGroups = new Map<string, AddedGroup>();
        for (const p of added) {
            const key = `${p.fromAssignmentId}|${p.toAssignmentId}`;
            const g = addedGroups.get(key);
            if (g) {
                g.vehicleIds.push(p.vehicleId);
                for (const u of p.notifiedUserIds) g.userIds.add(u);
            } else {
                addedGroups.set(key, {
                    pair: p,
                    vehicleIds: [p.vehicleId],
                    userIds: new Set(p.notifiedUserIds),
                });
            }
        }

        let addedSentGroups = 0;
        let suppressedAddedPairs = 0;
        for (const g of addedGroups.values()) {
            const toA = assignmentById.get(g.pair.toAssignmentId);
            if (!toA) continue;
            g.vehicleIds.sort(); // pushTag と本文の並びを再計算間で安定させる
            const toDateKey = dateKeyJst(toA.date);
            const userIds = Array.from(g.userIds);
            const shouldNotify = toDateKey >= todayKey && userIds.length > 0;

            // INSERT VehicleHandoverNotice rows（1 pair = 1 row, 多車両は同集約だが pair は別）。
            // 通知しないペアも受信者ゼロで「送ったことにして」記録する。記録しないと
            // 次回の再計算でまた added に湧き、差分が収束しない。
            await prisma.$transaction(
                g.vehicleIds.map(vid =>
                    prisma.vehicleHandoverNotice.create({
                        data: {
                            vehicleId: vid,
                            fromAssignmentId: g.pair.fromAssignmentId,
                            toAssignmentId: g.pair.toAssignmentId,
                            notifiedUserIds: JSON.stringify(shouldNotify ? userIds : []),
                        },
                    })
                )
            );

            if (!shouldNotify) {
                if (toDateKey < todayKey) suppressedAddedPairs += g.vehicleIds.length;
                continue;
            }

            const teamName = foremanById.get(toA.assignedEmployeeId)?.displayName
                ? `${foremanById.get(toA.assignedEmployeeId)!.displayName}班`
                : 'ほかの班';
            const vehicleList = formatVehicleList(g.vehicleIds);
            const dateStr = formatJpShortDate(toA.date);
            const body = `車両（${vehicleList}）は ${dateStr} ${teamName} が使用します`;
            const pushTag = `vehicle-handover-${g.vehicleIds[0]}-${toDateKey}`;

            await notifyUsers({
                userIds,
                type: 'vehicle-handover',
                title: '【車両引き継ぎ】',
                body,
                url: '/?page=schedule&view=assignment',
                pushTag,
            });
            addedSentGroups += 1;
        }

        // === 10. removed: canceledAt を一括セット → 取消通知 ===
        // 取消通知は added と同じ (fromAssignmentId, toAssignmentId) 単位で集約し、
        // pushTag も added と同じ形（先頭車両 + to側日付）にして OS 通知を上書きさせる（P1-2）。
        const rowByKey = new Map<string, (typeof existingRows)[number]>();
        for (const r of diffableRows) {
            rowByKey.set(`${r.vehicleId}|${r.fromAssignmentId}|${r.toAssignmentId}`, r);
        }
        const removedRowIds: string[] = [];
        for (const p of removed) {
            const row = rowByKey.get(`${p.vehicleId}|${p.fromAssignmentId}|${p.toAssignmentId}`);
            if (row) removedRowIds.push(row.id);
        }
        if (removedRowIds.length > 0) {
            await prisma.vehicleHandoverNotice.updateMany({
                where: { id: { in: removedRowIds } },
                data: { canceledAt: new Date() },
            });
        }

        type RemovedGroup = { vehicleIds: string[]; userIds: Set<string>; toDateKey: string };
        const removedGroups = new Map<string, RemovedGroup>();
        let suppressedRemovedPairs = 0;
        for (const p of removed) {
            const toA = assignmentById.get(p.toAssignmentId);
            const toDateKey = toA ? dateKeyJst(toA.date) : null;
            if (!toDateKey || toDateKey < todayKey) {
                // 引き継ぎ日が過去（または参照先が消えている）＝済んだ話。取消は記録のみ。
                suppressedRemovedPairs += 1;
                continue;
            }
            const key = `${p.fromAssignmentId}|${p.toAssignmentId}`;
            const g = removedGroups.get(key);
            if (g) {
                g.vehicleIds.push(p.vehicleId);
                for (const u of p.notifiedUserIds) g.userIds.add(u);
            } else {
                removedGroups.set(key, {
                    vehicleIds: [p.vehicleId],
                    userIds: new Set(p.notifiedUserIds),
                    toDateKey,
                });
            }
        }

        let removedSentGroups = 0;
        for (const g of removedGroups.values()) {
            const userIds = Array.from(g.userIds);
            if (userIds.length === 0) continue;
            g.vehicleIds.sort();
            const vehicleList = formatVehicleList(g.vehicleIds);
            const body = `先ほどの車両引き継ぎ（${vehicleList}）は取り消されました／変更されました`;
            const pushTag = `vehicle-handover-${g.vehicleIds[0]}-${g.toDateKey}`;

            await notifyUsers({
                userIds,
                type: 'vehicle-handover',
                title: '【車両引き継ぎ】',
                body,
                url: '/?page=schedule&view=assignment',
                pushTag,
            });
            removedSentGroups += 1;
        }

        return NextResponse.json({
            mode,
            added: added.length,
            removed: removed.length,
            addedSentGroups,
            removedSentGroups,
            suppressedAddedPairs,
            suppressedRemovedPairs,
            orphanedRows: orphanRowIds.length,
        });
    } catch (error) {
        return serverErrorResponse('車両引き継ぎ通知の送信', error);
    }
}
