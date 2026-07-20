// 案件カード/ホバープレビューで表示する車両名の解決（PCホバーとモバイルカードで共有）
export interface VehicleNameSource {
    isDispatchConfirmed?: boolean;
    confirmedVehicleIds?: string[];
    vehicles?: string[];
    trucks?: string[];
}

export function resolveEventVehicleNames(
    source: VehicleNameSource,
    vehicleMaster: { id: string; name: string }[]
): string[] {
    // 確定済みかつ確定車両があれば優先
    if (source.isDispatchConfirmed && source.confirmedVehicleIds?.length) {
        return source.confirmedVehicleIds.map(id => vehicleMaster.find(v => v.id === id)?.name ?? '不明');
    }
    // 未確定 or 確定車両未設定 → 計画段階の車両名（既に名前で保存）
    const planned = (source.vehicles ?? source.trucks ?? []) as string[];
    return planned.filter(Boolean);
}
