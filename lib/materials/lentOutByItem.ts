/**
 * 品目軸の「貸出中」集計エンジン（在庫一覧の現場別逆引き / 単一の正）
 *
 * lib/materials/lentOut.ts は「現場スコープ（ある現場に何が出ているか）」の集計だが、
 * 本ファイルは「品目スコープ（ある品目がどの現場に出ているか）」と
 * 「品目ごとの貸出中合計（所有総数の算出に使う）」を担う。
 *
 * 集計ルールは lentOut.ts と完全に同一:
 *   貸出中 = Σ(出庫) − Σ(返却) − Σ(紛失)、対象は status='loaded' の伝票のみ。
 *   '出庫' は加算、それ以外（'返却' / '紛失'）は減算。
 *   シートは完全在庫管理対応で MaterialRequisitionItem 行を持つため本集計に含む。
 *   リース品のみ（excludeFromStockDecrement）行を持たず本集計の対象外（在庫連動と同じ範囲）。
 *
 * 純粋関数（DB 非依存）。API・テスト双方から利用する。
 */

/** 出庫として加算扱いする type（これ以外は減算）。lentOut.ts と揃える。 */
const DISPATCH_TYPE = '出庫';

/** 集計に必要な伝票明細の最小形状。 */
export interface SiteLentOutItemInput {
    materialItemId: string;
    quantity: number;
    materialItem: {
        name: string;
        spec: string | null;
        unit: string;
        sortOrder: number;
        category: { name: string; sortOrder: number };
    };
}

/** 集計に必要な伝票の最小形状（現場・担当・日付付き）。 */
export interface SiteLentOutRequisitionInput {
    /** '出庫' | '返却' | '紛失' */
    type: string;
    /** 'draft' | 'confirmed' | 'loaded' */
    status: string;
    projectMasterId: string;
    projectName: string;
    foremanName: string | null;
    /** ISO 文字列 or Date。最終出庫日の算出に使う。 */
    date: string;
    items: SiteLentOutItemInput[];
}

/** 現場カードに並ぶ 1 品目。 */
export interface LentOutSiteItem {
    materialItemId: string;
    name: string;
    spec: string | null;
    unit: string;
    categorySortOrder: number;
    itemSortOrder: number;
    lentOut: number;
}

/** 「どの現場に出ているか」の 1 現場。 */
export interface LentOutSite {
    projectMasterId: string;
    projectName: string;
    /** 最終出庫日（その現場の '出庫' 伝票の最新 date / ISO 文字列） */
    lastDispatchDate: string | null;
    /** 最終出庫伝票の担当（職長）名 */
    foremanName: string | null;
    /** 貸出中(>0) の品目のみ。カテゴリ→品目順。 */
    items: LentOutSiteItem[];
    /** 現場に出ている総点数（items の lentOut 合計） */
    totalQuantity: number;
}

/** 品目→現場の逆引き 1 行。 */
export interface LentOutByItemSite {
    projectMasterId: string;
    projectName: string;
    foremanName: string | null;
    lentOut: number;
    lastDispatchDate: string | null;
}

/**
 * 品目ごとの貸出中合計を返す（lentOut > 0 のみ）。
 * 所有総数 = stockQuantity + summary[materialItemId] の算出に使う。
 */
export function computeLentOutSummary(
    requisitions: SiteLentOutRequisitionInput[],
): Record<string, number> {
    const map = new Map<string, number>();
    for (const req of requisitions) {
        if (req.status !== 'loaded') continue;
        const sign = req.type === DISPATCH_TYPE ? 1 : -1;
        for (const item of req.items) {
            map.set(item.materialItemId, (map.get(item.materialItemId) ?? 0) + sign * item.quantity);
        }
    }
    const result: Record<string, number> = {};
    for (const [id, qty] of map) {
        if (qty > 0) result[id] = qty;
    }
    return result;
}

/**
 * 現場別の貸出中一覧を返す。現場ごとに貸出中(>0) の品目をまとめ、
 * 1 品目以上残っている現場のみを最終出庫日の新しい順で返す。
 */
export function computeLentOutSites(
    requisitions: SiteLentOutRequisitionInput[],
): LentOutSite[] {
    interface SiteAccum {
        projectMasterId: string;
        projectName: string;
        lastDispatchDate: string | null;
        foremanName: string | null;
        items: Map<string, LentOutSiteItem>;
    }
    const sites = new Map<string, SiteAccum>();

    for (const req of requisitions) {
        if (req.status !== 'loaded') continue;
        const sign = req.type === DISPATCH_TYPE ? 1 : -1;

        let site = sites.get(req.projectMasterId);
        if (!site) {
            site = {
                projectMasterId: req.projectMasterId,
                projectName: req.projectName,
                lastDispatchDate: null,
                foremanName: null,
                items: new Map(),
            };
            sites.set(req.projectMasterId, site);
        }

        // 最終出庫日・担当は '出庫' 伝票の最新を採用
        if (req.type === DISPATCH_TYPE) {
            if (!site.lastDispatchDate || req.date > site.lastDispatchDate) {
                site.lastDispatchDate = req.date;
                site.foremanName = req.foremanName;
            }
        }

        for (const item of req.items) {
            const existing = site.items.get(item.materialItemId);
            if (existing) {
                existing.lentOut += sign * item.quantity;
            } else {
                const mi = item.materialItem;
                site.items.set(item.materialItemId, {
                    materialItemId: item.materialItemId,
                    name: mi.name,
                    spec: mi.spec,
                    unit: mi.unit,
                    categorySortOrder: mi.category.sortOrder,
                    itemSortOrder: mi.sortOrder,
                    lentOut: sign * item.quantity,
                });
            }
        }
    }

    const result: LentOutSite[] = [];
    for (const site of sites.values()) {
        const items = Array.from(site.items.values())
            .filter((it) => it.lentOut > 0)
            .sort(
                (a, b) =>
                    a.categorySortOrder - b.categorySortOrder ||
                    a.itemSortOrder - b.itemSortOrder ||
                    a.name.localeCompare(b.name, 'ja'),
            );
        if (items.length === 0) continue;
        result.push({
            projectMasterId: site.projectMasterId,
            projectName: site.projectName,
            lastDispatchDate: site.lastDispatchDate,
            foremanName: site.foremanName,
            items,
            totalQuantity: items.reduce((s, it) => s + it.lentOut, 0),
        });
    }

    // 最終出庫日の新しい順（null は末尾）
    return result.sort((a, b) => {
        if (a.lastDispatchDate && b.lastDispatchDate) return b.lastDispatchDate.localeCompare(a.lastDispatchDate);
        if (a.lastDispatchDate) return -1;
        if (b.lastDispatchDate) return 1;
        return a.projectName.localeCompare(b.projectName, 'ja');
    });
}

/**
 * ある品目が出ている現場一覧を返す（現場別逆引きモーダル用）。
 * computeLentOutSites の結果から該当品目を抽出する。
 */
export function computeLentOutByItem(
    requisitions: SiteLentOutRequisitionInput[],
    materialItemId: string,
): LentOutByItemSite[] {
    const sites = computeLentOutSites(requisitions);
    const result: LentOutByItemSite[] = [];
    for (const site of sites) {
        const item = site.items.find((it) => it.materialItemId === materialItemId);
        if (!item) continue;
        result.push({
            projectMasterId: site.projectMasterId,
            projectName: site.projectName,
            foremanName: site.foremanName,
            lentOut: item.lentOut,
            lastDispatchDate: site.lastDispatchDate,
        });
    }
    return result.sort((a, b) => b.lentOut - a.lentOut);
}
