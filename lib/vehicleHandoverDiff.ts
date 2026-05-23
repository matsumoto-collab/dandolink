/**
 * 車両引き継ぎ通知の差分管理ロジック（純粋関数）。
 *
 * §4-3 の「いまあるべき引き継ぎ集合」と既存の有効レコードから added/removed を算出する。
 * DB アクセスは呼び出し側の責務。
 *
 * S-2 ルール（指示書）：同一 (teamId, dateKey, vehicleId) に兄弟手配が複数ある場合、
 *   - fromAssignmentId は辞書順最小 assignmentId を採用する
 *   - notifiedUserIds は兄弟の confirmedWorkerIds の和集合（dedupe）にする
 */

import { computeVehicleHandovers, type VehicleUsage } from './vehicleHandover';

export interface HandoverPair {
    vehicleId: string;
    /** 旧使用班の代表 assignmentId（通知を受け取る班） */
    fromAssignmentId: string;
    /** 新使用班の代表 assignmentId */
    toAssignmentId: string;
    /** 通知受信者の userId 配列（dedupe 済み） */
    notifiedUserIds: string[];
}

export interface HandoverDiff {
    added: HandoverPair[];
    removed: HandoverPair[];
}

export interface TargetInfo {
    assignmentId: string;
    teamId: string;
    dateKey: string;
    vehicleIds: string[];
}

interface GroupRep {
    assignmentId: string;
    unionWorkers: string[];
}

function pairKey(p: { vehicleId: string; fromAssignmentId: string; toAssignmentId: string }): string {
    return `${p.vehicleId}|${p.fromAssignmentId}|${p.toAssignmentId}`;
}

function groupKey(teamId: string, dateKey: string, vehicleId: string): string {
    return `${teamId}|${dateKey}|${vehicleId}`;
}

/**
 * desired と existing から added / removed を算出する。
 * 同一性判定は (vehicleId, fromAssignmentId, toAssignmentId) で行う。
 * notifiedUserIds の差は added/removed に影響させない（送信単位は pair まで）。
 */
export function diffHandovers(
    desired: ReadonlyArray<HandoverPair>,
    existing: ReadonlyArray<HandoverPair>,
): HandoverDiff {
    const existingKeys = new Set(existing.map(pairKey));
    const desiredKeys = new Set(desired.map(pairKey));

    const added = desired.filter(d => !existingKeys.has(pairKey(d)));
    const removed = existing.filter(e => !desiredKeys.has(pairKey(e)));
    return { added, removed };
}

/**
 * (teamId, dateKey, vehicleId) ごとに「代表 assignmentId（辞書順最小）」と
 * 「兄弟 assignment の confirmedWorkerIds の和集合」を構築する。
 */
function buildGroupRepresentatives(
    allUsages: ReadonlyArray<VehicleUsage>,
    workersByAssignment: ReadonlyMap<string, ReadonlyArray<string>>,
): Map<string, GroupRep> {
    const siblings = new Map<string, string[]>();
    for (const u of allUsages) {
        const key = groupKey(u.teamId, u.dateKey, u.vehicleId);
        const list = siblings.get(key);
        if (list) {
            list.push(u.assignmentId);
        } else {
            siblings.set(key, [u.assignmentId]);
        }
    }

    const result = new Map<string, GroupRep>();
    for (const [key, ids] of siblings) {
        const sortedIds = [...ids].sort();
        const rep = sortedIds[0];
        const workers = new Set<string>();
        for (const id of sortedIds) {
            const ws = workersByAssignment.get(id);
            if (ws) {
                for (const w of ws) {
                    if (w) workers.add(w);
                }
            }
        }
        result.set(key, { assignmentId: rep, unionWorkers: Array.from(workers) });
    }
    return result;
}

/**
 * 「いまあるべき引き継ぎ pair の集合」を targets と allUsages から構築する。
 *
 * 各 target ごとに computeVehicleHandovers で前後を取り、双方向の pair を生成する。
 *   - prior 方向（過去 → target）: 受信者 = prior 班のメンバー
 *   - next  方向（target → 未来）: 受信者 = target 班のメンバー
 *
 * 同じ pair が複数の target から作られても dedupe する。
 */
export function buildDesiredHandoverPairs(
    targets: ReadonlyArray<TargetInfo>,
    allUsages: ReadonlyArray<VehicleUsage>,
    workersByAssignment: ReadonlyMap<string, ReadonlyArray<string>>,
    options?: { searchRangeDays?: number },
): HandoverPair[] {
    const groupRep = buildGroupRepresentatives(allUsages, workersByAssignment);
    const pairs: HandoverPair[] = [];
    const seen = new Set<string>();

    const pushPair = (
        vehicleId: string,
        fromTeam: string,
        fromDate: string,
        toTeam: string,
        toDate: string,
    ) => {
        const fromRep = groupRep.get(groupKey(fromTeam, fromDate, vehicleId));
        const toRep = groupRep.get(groupKey(toTeam, toDate, vehicleId));
        if (!fromRep || !toRep) return;
        if (fromRep.assignmentId === toRep.assignmentId) return;
        const pair: HandoverPair = {
            vehicleId,
            fromAssignmentId: fromRep.assignmentId,
            toAssignmentId: toRep.assignmentId,
            notifiedUserIds: fromRep.unionWorkers,
        };
        const k = pairKey(pair);
        if (seen.has(k)) return;
        seen.add(k);
        pairs.push(pair);
    };

    for (const t of targets) {
        const handovers = computeVehicleHandovers(
            { teamId: t.teamId, dateKey: t.dateKey, vehicleIds: t.vehicleIds },
            allUsages,
            options,
        );
        for (const h of handovers) {
            if (h.prior) {
                pushPair(h.vehicleId, h.prior.teamId, h.prior.dateKey, t.teamId, t.dateKey);
            }
            if (h.next) {
                pushPair(h.vehicleId, t.teamId, t.dateKey, h.next.teamId, h.next.dateKey);
            }
        }
    }

    return pairs;
}
