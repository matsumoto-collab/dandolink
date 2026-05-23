import {
    diffHandovers,
    buildDesiredHandoverPairs,
    type HandoverPair,
    type TargetInfo,
} from '@/lib/vehicleHandoverDiff';
import type { VehicleUsage } from '@/lib/vehicleHandover';

function usage(assignmentId: string, teamId: string, dateKey: string, vehicleId: string): VehicleUsage {
    return { assignmentId, teamId, dateKey, vehicleId };
}

function pair(
    vehicleId: string,
    fromAssignmentId: string,
    toAssignmentId: string,
    notifiedUserIds: string[],
): HandoverPair {
    return { vehicleId, fromAssignmentId, toAssignmentId, notifiedUserIds };
}

describe('diffHandovers', () => {
    it('完全一致 → added/removed 空', () => {
        const p = pair('v1', 'a1', 'a2', ['u1']);
        const result = diffHandovers([p], [p]);
        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([]);
    });

    it('desired のみ → added', () => {
        const p = pair('v1', 'a1', 'a2', ['u1']);
        const result = diffHandovers([p], []);
        expect(result.added).toEqual([p]);
        expect(result.removed).toEqual([]);
    });

    it('existing のみ → removed', () => {
        const p = pair('v1', 'a1', 'a2', ['u1']);
        const result = diffHandovers([], [p]);
        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([p]);
    });

    it('部分一致 → 差分が added/removed に分かれる', () => {
        const keep = pair('v1', 'a1', 'a2', ['u1']);
        const added = pair('v2', 'a3', 'a4', ['u2']);
        const removed = pair('v3', 'a5', 'a6', ['u3']);
        const result = diffHandovers([keep, added], [keep, removed]);
        expect(result.added).toEqual([added]);
        expect(result.removed).toEqual([removed]);
    });

    it('notifiedUserIds の差は同一性に影響しない（pair key 一致なら not added/removed）', () => {
        const a = pair('v1', 'a1', 'a2', ['u1']);
        const b = pair('v1', 'a1', 'a2', ['u1', 'u2']);  // 同じ pair, workers 違い
        const result = diffHandovers([b], [a]);
        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([]);
    });
});

describe('buildDesiredHandoverPairs', () => {
    it('1: 隣接日・別班 (5/18 A → 5/19 B) を 5/19 B が確定 → prior pair 1つ', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-alice', 'u-bob']],
            ['a2', ['u-carol']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        expect(result).toEqual([
            { vehicleId: 'v1', fromAssignmentId: 'a1', toAssignmentId: 'a2', notifiedUserIds: ['u-alice', 'u-bob'] },
        ]);
    });

    it('2: 数日空き → prior pair 1つ', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-22', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-22', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-alice']],
            ['a2', ['u-carol']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        expect(result).toHaveLength(1);
        expect(result[0].fromAssignmentId).toBe('a1');
        expect(result[0].toAssignmentId).toBe('a2');
        expect(result[0].notifiedUserIds).toEqual(['u-alice']);
    });

    it('3: 同一班連続 → pair 0（同班は通知対象外）', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'A', '2026-05-19', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'A', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-x']],
            ['a2', ['u-x']],
        ]);
        expect(buildDesiredHandoverPairs(targets, allUsages, workers)).toEqual([]);
    });

    it('4: 双方向 (5/18 A → 5/19 B(target) → 5/20 C) → 2 pairs (prior + next)', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a3', 'C', '2026-05-20', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-alice']],
            ['a2', ['u-bob']],
            ['a3', ['u-carol']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        expect(result).toHaveLength(2);
        // prior 方向: a1 → a2、受信者 = prior 班 a1 のメンバー
        const prior = result.find(p => p.fromAssignmentId === 'a1');
        expect(prior).toBeDefined();
        expect(prior!.toAssignmentId).toBe('a2');
        expect(prior!.notifiedUserIds).toEqual(['u-alice']);
        // next 方向: a2 → a3、受信者 = target 班 a2 のメンバー
        const next = result.find(p => p.fromAssignmentId === 'a2');
        expect(next).toBeDefined();
        expect(next!.toAssignmentId).toBe('a3');
        expect(next!.notifiedUserIds).toEqual(['u-bob']);
    });

    it('5: 多車両 → 各車両ぶん pair が出る', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a1', 'A', '2026-05-18', 'v2'),  // a1 が v2 も持つ
            usage('a2', 'B', '2026-05-19', 'v2'),  // a2 も v2 を引き継ぐ
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1', 'v2'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-alice']],
            ['a2', ['u-carol']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        expect(result).toHaveLength(2);
        const v1Pair = result.find(p => p.vehicleId === 'v1');
        const v2Pair = result.find(p => p.vehicleId === 'v2');
        expect(v1Pair?.fromAssignmentId).toBe('a1');
        expect(v2Pair?.fromAssignmentId).toBe('a1');
    });

    it('6: S-2 同(team,day) 兄弟複数 → fromAssignmentId は辞書順最小、workers は和集合', () => {
        // 5/18 A 班に 2 つの兄弟手配 (a1, a2) があり、両方 v1 を確定
        // 5/19 B 班 (target) → 受信者班は A 班、代表 = min(a1, a2) = 'a1'、workers = u1 ∪ u2 ∪ u3
        const allUsages: VehicleUsage[] = [
            usage('a2', 'A', '2026-05-18', 'v1'),
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a3', 'B', '2026-05-19', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a3', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a2', ['u-2a', 'u-shared']],
            ['a1', ['u-1a', 'u-shared']],
            ['a3', ['u-3']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        expect(result).toHaveLength(1);
        const p = result[0];
        expect(p.fromAssignmentId).toBe('a1');  // 辞書順最小
        expect(p.toAssignmentId).toBe('a3');
        // union dedupe: u-1a, u-shared, u-2a が含まれる
        expect(new Set(p.notifiedUserIds)).toEqual(new Set(['u-1a', 'u-2a', 'u-shared']));
    });

    it('7: 中間挿入シナリオ (先に A→C を確定済み、後で B を確定) → A→C は消え、A→B / B→C が現れる', () => {
        // 中間挿入後の世界では B が target。allUsages = {a-A: 5/18, a-B: 5/19, a-C: 5/20}
        const allUsages: VehicleUsage[] = [
            usage('a-A', 'A', '2026-05-18', 'v1'),
            usage('a-B', 'B', '2026-05-19', 'v1'),
            usage('a-C', 'C', '2026-05-20', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a-B', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a-A', ['u-a']],
            ['a-B', ['u-b']],
            ['a-C', ['u-c']],
        ]);
        const desired = buildDesiredHandoverPairs(targets, allUsages, workers);
        // 既存（古い世界 = B 無し）の有効レコードは A→C 1つだったとする
        const existing: HandoverPair[] = [
            pair('v1', 'a-A', 'a-C', ['u-a']),
        ];
        const diff = diffHandovers(desired, existing);
        // 取り消し: A→C
        expect(diff.removed).toEqual([
            pair('v1', 'a-A', 'a-C', ['u-a']),
        ]);
        // 追加: A→B / B→C
        const addedKeys = diff.added.map(p => `${p.fromAssignmentId}->${p.toAssignmentId}`).sort();
        expect(addedKeys).toEqual(['a-A->a-B', 'a-B->a-C']);
    });

    it('8: target.vehicleIds が空 → pair なし', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: [] },
        ];
        const workers = new Map<string, string[]>([['a1', ['u-1']]]);
        expect(buildDesiredHandoverPairs(targets, allUsages, workers)).toEqual([]);
    });

    it('9: 同じ pair が複数 target から作られても 1 つに dedupe される', () => {
        // 5/18 A → 5/19 B → 5/20 C で target を a2 と a3 にすると、
        // a2 が a1→a2 と a2→a3 を、a3 が a2→a3 を出す → a2→a3 が dedupe される
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a3', 'C', '2026-05-20', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            { assignmentId: 'a3', teamId: 'C', dateKey: '2026-05-20', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-a']],
            ['a2', ['u-b']],
            ['a3', ['u-c']],
        ]);
        const result = buildDesiredHandoverPairs(targets, allUsages, workers);
        // 期待される pair: a1→a2 (prior of a2), a2→a3 (next of a2 = prior of a3)
        // a3 の next は無いので、合計 2 pair
        expect(result).toHaveLength(2);
        const keys = result.map(p => `${p.fromAssignmentId}->${p.toAssignmentId}`).sort();
        expect(keys).toEqual(['a1->a2', 'a2->a3']);
    });

    it('10: 範囲外 (31日前) → pair なし', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-04-18', 'v1'),  // 31日前
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const targets: TargetInfo[] = [
            { assignmentId: 'a2', teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
        ];
        const workers = new Map<string, string[]>([
            ['a1', ['u-a']],
            ['a2', ['u-b']],
        ]);
        expect(buildDesiredHandoverPairs(targets, allUsages, workers)).toEqual([]);
    });
});
