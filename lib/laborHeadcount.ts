/**
 * 利益サマリー「人件費」の人数集計。
 *
 * 配置(日付)ごとの人件費明細が持つ workerCount（その日に原価計上した作業者数）を合計し、
 * 職長×作業内容ごとの内訳も返す。人数は「日ごとの人数の合計（延べ人数）」で、
 * 同じ人が2日出れば2人と数える。
 */
export interface LaborHeadcountSource {
    foremanName: string | null;
    constructionTypeName: string | null;
    workerCount: number;
}

export interface LaborHeadcountGroup {
    /** 職長名。未割当は UNASSIGNED_FOREMAN_LABEL */
    foremanName: string;
    /** 作業内容(工事種別)名。不明は UNKNOWN_CONSTRUCTION_TYPE_LABEL */
    constructionTypeName: string;
    count: number;
}

export interface LaborHeadcountSummary {
    /** 全明細の人数合計（延べ） */
    total: number;
    /** 職長×作業内容ごとの人数。0人の組は含めない */
    groups: LaborHeadcountGroup[];
}

export const UNASSIGNED_FOREMAN_LABEL = '未割当';
export const UNKNOWN_CONSTRUCTION_TYPE_LABEL = '—';

/**
 * 並びは「職長の初出順 → その職長の中で作業内容の初出順」。
 * 明細は日付昇順で渡ってくるので、時系列に近い順（組立→解体など）で並ぶ。
 */
export function summarizeLaborHeadcount(rows: LaborHeadcountSource[]): LaborHeadcountSummary {
    const byForeman = new Map<string, Map<string, number>>();
    let total = 0;
    for (const r of rows) {
        const count = Number.isFinite(r.workerCount) && r.workerCount > 0 ? Math.floor(r.workerCount) : 0;
        if (count === 0) continue; // 日報未提出などで人数0の明細は内訳に出さない
        total += count;
        const foreman = r.foremanName?.trim() || UNASSIGNED_FOREMAN_LABEL;
        const type = r.constructionTypeName?.trim() || UNKNOWN_CONSTRUCTION_TYPE_LABEL;
        let inner = byForeman.get(foreman);
        if (!inner) {
            inner = new Map();
            byForeman.set(foreman, inner);
        }
        inner.set(type, (inner.get(type) ?? 0) + count);
    }
    const groups: LaborHeadcountGroup[] = [];
    for (const [foremanName, inner] of byForeman) {
        for (const [constructionTypeName, count] of inner) {
            groups.push({ foremanName, constructionTypeName, count });
        }
    }
    return { total, groups };
}

/** 表示用: 「田畑 組立 5人・小笠原 組立 4人」 */
export function formatLaborHeadcountGroups(groups: LaborHeadcountGroup[]): string {
    return groups.map(g => `${g.foremanName} ${g.constructionTypeName} ${g.count}人`).join('・');
}
