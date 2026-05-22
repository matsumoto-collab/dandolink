/**
 * 車両引き継ぎ通知の突合ロジック。
 *
 * 純粋関数として実装する。DB アクセスや Date 演算は呼び出し側の責務。
 * 入力は JST 日キー文字列 ("YYYY-MM-DD") として扱い、関数内では文字列比較のみで
 * 日付の前後関係を判定する。これにより JST/UTC 境界バグを構造的に避ける。
 */

export interface VehicleUsage {
    assignmentId: string;
    teamId: string;
    dateKey: string;       // JST "YYYY-MM-DD"
    vehicleId: string;
}

export interface VehicleHandovers {
    vehicleId: string;
    prior: VehicleUsage | null;
    next: VehicleUsage | null;
}

const DEFAULT_SEARCH_RANGE_DAYS = 30;

function addDaysToDateKey(dateKey: string, days: number): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    const yy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

export function computeVehicleHandovers(
    target: { teamId: string; dateKey: string; vehicleIds: string[] },
    allUsages: ReadonlyArray<VehicleUsage>,
    options?: { searchRangeDays?: number },
): VehicleHandovers[] {
    const rangeDays = options?.searchRangeDays ?? DEFAULT_SEARCH_RANGE_DAYS;
    const lowerBound = addDaysToDateKey(target.dateKey, -rangeDays);
    const upperBound = addDaysToDateKey(target.dateKey, rangeDays);

    return target.vehicleIds.map(vehicleId => {
        const candidates = allUsages.filter(u =>
            u.vehicleId === vehicleId
            && u.teamId !== target.teamId
            && u.dateKey !== target.dateKey
            && u.dateKey >= lowerBound
            && u.dateKey <= upperBound,
        );

        let prior: VehicleUsage | null = null;
        let next: VehicleUsage | null = null;
        for (const u of candidates) {
            if (u.dateKey < target.dateKey) {
                if (!prior || u.dateKey > prior.dateKey) prior = u;
            } else if (u.dateKey > target.dateKey) {
                if (!next || u.dateKey < next.dateKey) next = u;
            }
        }

        return { vehicleId, prior, next };
    });
}
