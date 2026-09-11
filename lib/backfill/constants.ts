/**
 * 過去データ取込（DandoLink 導入前 2024-01〜2026-04）の約束ごと。
 *
 * --- 期間の集計の切り替え（kei 決定 2026-09-11）---
 * 2026-01〜04 は DandoLink の試用期間で、本物のデータ（請求書・日報）と過去データが同じ作業を
 * 両方で持っている。足すと二重になるので、期間の集計（利益ダッシュボード・一人当たりの稼ぎタブ）は
 *   ・2026-04 まで … 過去データ（isBackfilled=true）と売上調整（RevenueAdjustment）
 *   ・2026-05 から … DandoLink のデータ（isBackfilled=false）
 * で数える。試用期間の本物のデータは消さない（案件詳細では今まで通り見える）が、期間の集計には使わない。
 */

/** DandoLink のデータで数え始める月（この月から先は過去データを使わない） */
export const LIVE_DATA_START_MONTH = '2026-05';

/** LIVE_DATA_START_MONTH の JST 1 日 0 時（= UTC 前日 15 時）。Invoice.createdAt などの比較に使う */
export const LIVE_DATA_START = new Date(Date.UTC(2026, 4, 1, -9, 0, 0, 0));

/** 'YYYY-MM' が DandoLink のデータで数える月か */
export function isLiveMonth(yearMonth: string): boolean {
    return yearMonth >= LIVE_DATA_START_MONTH;
}

/**
 * 期間の集計（月次売上・一人当たりの稼ぎタブの期別/月別）に、この行を数えるか。
 *   過去データ   → LIVE_DATA_START_MONTH より前の月だけ数える
 *   DandoLink    → LIVE_DATA_START_MONTH からの月だけ数える（試用期間 2026-01〜04 の分は過去データと重なるので数えない）
 * 判定はここ 1 か所にまとめる（集計ごとに書くと境目がずれて二重計上の元になる）。
 */
export function countsInPeriodAggregate(isBackfilled: boolean, yearMonth: string): boolean {
    return isBackfilled ? !isLiveMonth(yearMonth) : isLiveMonth(yearMonth);
}

/** 税抜の金額を税込（10%）に戻す。過去データの売上調整は売上入金表(税込) ÷ 1.1 で作られている */
export function withConsumptionTax(amountExclTax: number): number {
    return amountExclTax + Math.round(amountExclTax * 0.1);
}

/**
 * 職長が既存ユーザーと一致しない過去の作業履歴に入れる assignedEmployeeId。
 * 'unassigned'（浮き）と取り違えないよう専用の値にする。表示名は backfillInfo.foremanName を使う。
 */
export const BACKFILL_UNMATCHED_FOREMAN_ID = '__backfill__';

/** 過去データの請求書番号の頭。通常の採番（I{西暦}{連番}）と重ならないようにする */
export const BACKFILL_INVOICE_NUMBER_PREFIX = 'BF-';

/** 過去データの取込元（案件CSVの「出典」） */
export const BACKFILL_DATA_SOURCES = ['請求書+日報', '請求書', '日報のみ'] as const;
export type BackfillDataSource = (typeof BACKFILL_DATA_SOURCES)[number];

// ---- 期（決算期） ------------------------------------------------------------
// 雄伸工業の期は 3 月始まり。第11期 = 2024-03〜2025-02（決算書・仕様書の数え方）。

/** 期の始まりの月（1〜12） */
export const FISCAL_START_MONTH = 3;
/** 「期の始まりの年」から第N期を出すための差（2024 年 3 月始まり = 第11期 → 2024 − 11） */
const FISCAL_TERM_OFFSET = 2013;

/** 'YYYY-MM' が属する期（第N期の N） */
export function fiscalTermOf(yearMonth: string): number {
    const [y, m] = yearMonth.split('-').map(Number);
    const startYear = m >= FISCAL_START_MONTH ? y : y - 1;
    return startYear - FISCAL_TERM_OFFSET;
}

/** 第N期の最初と最後の月（'YYYY-MM'） */
export function fiscalTermRange(term: number): { from: string; to: string } {
    const startYear = term + FISCAL_TERM_OFFSET;
    const pad = (n: number) => String(n).padStart(2, '0');
    // 3 月始まりなので、終わりは翌年の 2 月
    return { from: `${startYear}-${pad(FISCAL_START_MONTH)}`, to: `${startYear + 1}-${pad(FISCAL_START_MONTH - 1)}` };
}

/** 'YYYY-MM-DD'（JST のカレンダー日）を、その日の JST 0 時を表す UTC 時刻にする */
export function jstDateToInstant(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
}

/** Date（実時刻）を JST の 'YYYY-MM' にする */
export function jstYearMonthOf(date: Date): string {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}
