/**
 * 請求締め日の共通ユーティリティ。
 * closingDay は 0=末締め、それ以外はその日（5/10/15/20/25 等）で締めることを表す。
 */

/** UI で選べる締め日（0=末締め）。顧客マスタ・請求ボードで共用。 */
export const CLOSING_DAY_OPTIONS = [0, 5, 10, 15, 20, 25] as const;

/** 締め日の表示ラベル（例: 0→「末締め」, 15→「15日締め」）。 */
export function closingDayLabel(day?: number | null): string {
    return !day || day <= 0 ? '末締め' : `${day}日締め`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 締め日 closingDay（0=末締め）で、reference 月（year, month0=0-11）に締まる期間 [from, to]（YYYY-MM-DD）。
 * - 末締め（0）＝暦月そのもの（例: 6月分＝6/1〜6/30）
 * - N日締め＝前月(N+1)日 〜 当月N日（例: 15日締め・6月分＝5/16〜6/15）
 */
export function closingPeriod(year: number, month0: number, closingDay?: number | null): { from: string; to: string } {
    const d = !closingDay || closingDay <= 0 ? 0 : closingDay;
    if (d === 0) {
        const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
        return { from: `${year}-${pad2(month0 + 1)}-01`, to: `${year}-${pad2(month0 + 1)}-${pad2(last)}` };
    }
    const to = `${year}-${pad2(month0 + 1)}-${pad2(d)}`;
    const prev = new Date(Date.UTC(year, month0 - 1, 1));
    const from = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}-${pad2(d + 1)}`;
    return { from, to };
}

/** 西暦年→令和年（2019年=令和1年）。足場業務では2019年以降のみ想定。 */
export function toReiwaYear(year: number): number {
    return year - 2018;
}

/** 締め日（year, month1=1始まり, day）から請求書タイトル「令和X年Y月Z日締めご請求書」を組み立てる。 */
export function formatClosingInvoiceTitle(year: number, month1: number, day: number): string {
    return `令和${toReiwaYear(year)}年${month1}月${day}日締めご請求書`;
}

/** YYYY-MM-DD（締め日）→ 請求書タイトル。 */
export function closingInvoiceTitleFromYmd(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return formatClosingInvoiceTitle(y, m, d);
}

/** 支払期限プリセット（締め日基準）。 */
export type DueDatePreset = 'nextMonthEnd' | 'secondMonth10' | 'secondMonth15';
export const DUE_DATE_PRESETS: { key: DueDatePreset; label: string }[] = [
    { key: 'nextMonthEnd', label: '翌月末' },
    { key: 'secondMonth10', label: '翌々月10日' },
    { key: 'secondMonth15', label: '翌々月15日' },
];

/**
 * 締め日（year, month0=0始まり）を基準に支払期限を YYYY-MM-DD で返す。
 * - 翌月末: 締め月の翌月末日（例: 6月締め→7/31）
 * - 翌々月10日 / 翌々月15日（例: 6月締め→8/10 / 8/15）
 * 月跨ぎは Date.UTC の正規化に任せる（カレンダー日付として扱い TZ 非依存）。
 */
export function dueDateFromClosing(year: number, month0: number, preset: DueDatePreset): string {
    const day = preset === 'secondMonth10' ? 10 : preset === 'secondMonth15' ? 15 : 0;
    // 翌月末は (month0+2) の day0 = 翌月の末日。10/15日は (month0+2) のその日。
    const d = new Date(Date.UTC(year, month0 + 2, day));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 締め日 closingDay で「今日を含む締め期間」の締め日（YYYY-MM-DD）を返す。
 * 例: 6/3 時点で 15日締め→6/15、末締め→6/30、25日締め→6/25、6/20 時点で 15日締め→7/15。
 * today.day <= closingDay なら当月、超えていれば翌月の締め日。末締めは当月末。
 * today はローカル（利用者＝JST）の暦日として解釈する。
 */
export function currentClosingDate(closingDay?: number | null, today: Date = new Date()): string {
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-based
    const day = today.getDate();
    const cd = !closingDay || closingDay <= 0 ? 0 : closingDay;
    let d: Date;
    if (cd === 0) d = new Date(Date.UTC(y, m + 1, 0)); // 当月末
    else if (day <= cd) d = new Date(Date.UTC(y, m, cd)); // 当月締め
    else d = new Date(Date.UTC(y, m + 1, cd)); // 翌月締め
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
