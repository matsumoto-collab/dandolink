/**
 * 在庫ステータス判定（純粋関数 / 単一の正）
 *
 * 在庫一覧の状態バッジ・行ハイライト・在庫バーの色分けを決める判定ロジック。
 * DB 非依存の純粋関数なので UI とテストの双方から利用する。
 *
 * --- 判定ルール（実装指示書 §4 準拠）---
 *   - stock < 0                      → 'shortage'（要確認・赤）。出し過ぎ等の矛盾。
 *   - 残率(stock / total) < しきい値 → 'low'（わずか・amber）。要発注。
 *   - それ以外                       → 'ok'（十分・ティール）。
 *
 *   total <= 0（所有総数 0）の品目は割合が定義できないため、
 *   stock < 0 のみ 'shortage'、それ以外は 'ok' とする。
 *
 * --- 対象外（excludeFromStockDecrement）---
 *   ネット / シート / リース品は在庫数の意味が異なる（数量の正は notes-JSON）。
 *   これらは在庫バー・警告の対象外とするため、呼び出し側で除外すること
 *   （本ヘルパは判定のみを担い、除外フィルタは持たない）。
 */

export type StockStatus = 'ok' | 'low' | 'shortage';

/** 「在庫わずか」と判定する残率のしきい値（案A: 残率 < 25%）。 */
export const LOW_STOCK_RATIO = 0.25;

/**
 * 倉庫在庫(stock)と所有総数(total)から在庫ステータスを判定する。
 * @param stock 倉庫在庫（MaterialItem.stockQuantity）
 * @param total 所有総数（stock + Σ貸出中）
 */
export function computeStockStatus(stock: number, total: number): StockStatus {
    if (stock < 0) return 'shortage';
    if (total <= 0) return 'ok';
    if (stock / total < LOW_STOCK_RATIO) return 'low';
    return 'ok';
}

/** ステータスの日本語ラベル。 */
export function stockStatusLabel(status: StockStatus): string {
    switch (status) {
        case 'shortage':
            return '要確認';
        case 'low':
            return 'わずか';
        default:
            return '十分';
    }
}

/**
 * 倉庫在庫の割合(%)。バーの幅・表示に使う。
 * total <= 0 や stock < 0 は 0% にクランプ（バーは 0〜100% の範囲で扱う）。
 */
export function stockRatioPercent(stock: number, total: number): number {
    if (total <= 0 || stock <= 0) return 0;
    return Math.min(100, Math.round((stock / total) * 100));
}
