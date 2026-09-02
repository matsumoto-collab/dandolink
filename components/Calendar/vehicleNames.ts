// 案件カード/ホバープレビューで表示する車両名・電動工具名の解決（PCホバーとモバイルカードで共有）
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

// 電動工具は車両と違い ID で配置に保存しているため、表示にはマスタでの名前解決が要る。
export interface ToolNameSource {
    isDispatchConfirmed?: boolean;
    confirmedToolIds?: string[];
    /** 予定の電動工具（Tool.id の配列） */
    tools?: string[];
}

export function resolveEventToolNames(
    source: ToolNameSource,
    toolMaster: { id: string; name: string }[]
): string[] {
    // 確定済みかつ確定工具があれば優先（車両と同じ考え方）
    const ids = source.isDispatchConfirmed && source.confirmedToolIds?.length
        ? source.confirmedToolIds
        : (source.tools ?? []);
    return ids.map(id => toolMaster.find(t => t.id === id)?.name ?? '不明');
}
