import { computeVehicleHandovers, VehicleUsage } from '@/lib/vehicleHandover';

function usage(assignmentId: string, teamId: string, dateKey: string, vehicleId: string): VehicleUsage {
    return { assignmentId, teamId, dateKey, vehicleId };
}

describe('computeVehicleHandovers', () => {
    it('1: 隣接日・別班 → prior=A班(5/18), next=null', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result).toEqual([
            {
                vehicleId: 'v1',
                prior: usage('a1', 'A', '2026-05-18', 'v1'),
                next: null,
            },
        ]);
    });

    it('2: 数日空き・別班 → prior=A班(5/18), next=null', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-22', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-22', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toEqual(usage('a1', 'A', '2026-05-18', 'v1'));
        expect(result[0].next).toBeNull();
    });

    it('3: 同一班連続 → prior=null, next=null（同班は通知対象外）', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'A', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'A', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toBeNull();
        expect(result[0].next).toBeNull();
    });

    it('4: 双方向 (prior=A班, next=C班)', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a3', 'C', '2026-05-20', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toEqual(usage('a1', 'A', '2026-05-18', 'v1'));
        expect(result[0].next).toEqual(usage('a3', 'C', '2026-05-20', 'v1'));
    });

    it('5: 検索範囲外 (31日前) → prior=null', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-04-18', 'v1'),  // 31日前
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toBeNull();
        expect(result[0].next).toBeNull();
    });

    it('6: 検索範囲ぎり (30日前) → prior=A班(4/19)', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-04-19', 'v1'),  // 30日前ちょうど
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toEqual(usage('a1', 'A', '2026-04-19', 'v1'));
    });

    it('7: 複数車両 → 各 vehicleId 分の handovers が返る', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a3', 'C', '2026-05-18', 'v2'),
            usage('a4', 'B', '2026-05-19', 'v2'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1', 'v2'] },
            allUsages,
        );
        expect(result).toHaveLength(2);
        const v1 = result.find(r => r.vehicleId === 'v1')!;
        const v2 = result.find(r => r.vehicleId === 'v2')!;
        expect(v1.prior?.teamId).toBe('A');
        expect(v2.prior?.teamId).toBe('C');
    });

    it('8: 同日別班 → prior=null, next=null', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-19', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toBeNull();
        expect(result[0].next).toBeNull();
    });

    it('9: 同日の中間別班スキップ (5/18 A → 5/19 X(target) と 5/19 Y) → next=null', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'X', '2026-05-19', 'v1'),
            usage('a3', 'Y', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'X', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior?.teamId).toBe('A');
        expect(result[0].next).toBeNull();
    });

    it('10: target の vehicleIds が空 → 戻り値も空配列', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: [] },
            allUsages,
        );
        expect(result).toEqual([]);
    });

    it('11: searchRangeDays カスタム値で範囲を狭めると拾わなくなる', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-15', 'v1'),  // 4日前
            usage('a2', 'B', '2026-05-19', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'B', dateKey: '2026-05-19', vehicleIds: ['v1'] },
            allUsages,
            { searchRangeDays: 3 },
        );
        expect(result[0].prior).toBeNull();
    });

    it('12: 同班が一度離れて戻る (5/18 A → 5/19 B → 5/20 A(target)) → prior=B班(5/19)', () => {
        const allUsages: VehicleUsage[] = [
            usage('a1', 'A', '2026-05-18', 'v1'),
            usage('a2', 'B', '2026-05-19', 'v1'),
            usage('a3', 'A', '2026-05-20', 'v1'),
        ];
        const result = computeVehicleHandovers(
            { teamId: 'A', dateKey: '2026-05-20', vehicleIds: ['v1'] },
            allUsages,
        );
        expect(result[0].prior).toEqual(usage('a2', 'B', '2026-05-19', 'v1'));
        expect(result[0].next).toBeNull();
    });
});
