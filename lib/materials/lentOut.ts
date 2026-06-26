/**
 * 現場別「貸出中」集計エンジン（返却機能の土台 / 単一の正）
 *
 * 貸出中(item) = Σ(出庫) − Σ(返却) − Σ(紛失)
 *   対象は status='loaded' の伝票のみ（＝実際に倉庫在庫が動いた分）。
 *   集計は MaterialRequisitionItem 行ベース。
 *
 * --- 対象範囲 ---
 *   シートは完全在庫管理対応で、出庫伝票のシート箱の数量が保存時に
 *   MaterialRequisitionItem 行へも展開される（在庫減算対象）。よってシートも
 *   本集計（貸出中）に含まれる。リース品のみ MaterialRequisitionItem 行を持たず
 *   （excludeFromStockDecrement）本集計の対象外（在庫連動と同じ範囲）。
 *
 * --- type と符号 ---
 *   '出庫' は加算（現場へ出た）、それ以外（'返却' / '紛失'）は減算（現場から消えた）。
 *   - '返却' : 物理的に倉庫へ戻った（applyStockForRequisition が在庫を加算）。
 *   - '紛失' : 紛失・破損で償却（貸出中からは除外するが倉庫在庫は触らない。
 *             出庫時点で既に在庫を減算済みのため二重減算しない）。
 *
 * 純粋関数（DB 非依存）。API・テスト双方から利用する。
 */

/** computeLentOut が必要とする伝票明細の最小形状 */
export interface LentOutRequisitionItemInput {
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

/** computeLentOut が必要とする伝票の最小形状 */
export interface LentOutRequisitionInput {
    /** '出庫' | '返却' | '紛失'（自由文 String） */
    type: string;
    /** 'draft' | 'confirmed' | 'loaded' */
    status: string;
    items: LentOutRequisitionItemInput[];
}

/** 貸出中の 1 品目 */
export interface LentOutItem {
    materialItemId: string;
    name: string;
    spec: string | null;
    unit: string;
    categoryName: string;
    categorySortOrder: number;
    itemSortOrder: number;
    /** 出ている数（出庫 − 返却 − 紛失、>0 のもののみ返す） */
    lentOut: number;
}

/** 出庫として加算扱いする type（これ以外は減算） */
const DISPATCH_TYPE = '出庫';

/**
 * loaded 伝票群から品目別の貸出中数量を算出する。
 * lentOut > 0 の品目のみを、カテゴリ→品目の sortOrder 順で返す。
 */
export function computeLentOut(
    requisitions: LentOutRequisitionInput[],
): LentOutItem[] {
    const map = new Map<string, LentOutItem>();

    for (const req of requisitions) {
        // 実際に在庫が動いた loaded 伝票のみを対象にする（集計ルールの権威）
        if (req.status !== 'loaded') continue;
        const sign = req.type === DISPATCH_TYPE ? 1 : -1;

        for (const item of req.items) {
            const mi = item.materialItem;
            const existing = map.get(item.materialItemId);
            if (existing) {
                existing.lentOut += sign * item.quantity;
            } else {
                map.set(item.materialItemId, {
                    materialItemId: item.materialItemId,
                    name: mi.name,
                    spec: mi.spec,
                    unit: mi.unit,
                    categoryName: mi.category.name,
                    categorySortOrder: mi.category.sortOrder,
                    itemSortOrder: mi.sortOrder,
                    lentOut: sign * item.quantity,
                });
            }
        }
    }

    return Array.from(map.values())
        .filter((it) => it.lentOut > 0)
        .sort(
            (a, b) =>
                a.categorySortOrder - b.categorySortOrder ||
                a.itemSortOrder - b.itemSortOrder ||
                a.name.localeCompare(b.name, 'ja'),
        );
}

/**
 * computeLentOut の結果を materialItemId -> lentOut の Map に畳む補助。
 * 返却 API のサーバ側クランプ（過返却防止）で使う。
 */
export function lentOutQuantityMap(
    requisitions: LentOutRequisitionInput[],
): Map<string, number> {
    const m = new Map<string, number>();
    for (const it of computeLentOut(requisitions)) {
        m.set(it.materialItemId, it.lentOut);
    }
    return m;
}
