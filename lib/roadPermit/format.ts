/**
 * 道路申請の表記の部品（純粋関数。画面と PDF の両方から使う）。
 *
 * 決まり（docs/指示書_道路申請_Phase1.md §9）
 * - 和暦は令和。年月日の文字は lib/joyoStatement の toReiwaYmd、年だけは lib/closingDay の toReiwaYear を使う
 * - 日数は初日と末日を含めて数える（令和7年5月1日〜8月31日 = 123日間）
 * - 「約○㎡」は数量を切り上げた整数（0.9486 → 1、1.821 → 2）。四捨五入にするかは §14-5 で kei に確認
 * - 空の日付は「令和　年　月　日」と空けて印刷（全角スペース）
 */
import { toReiwaYear } from '@/lib/closingDay';
import { toReiwaYmd } from '@/lib/joyoStatement';

/** 'YYYY-MM-DD' かつ実在する日 */
export function isValidYmd(ymd: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const d = new Date(`${ymd}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/** 日数（初日と末日を含める）。どちらかが空・不正・逆順なら null */
export function countDaysInclusive(from: string, to: string): number | null {
    if (!isValidYmd(from) || !isValidYmd(to)) return null;
    const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
    const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
    if (b < a) return null;
    return Math.round((b - a) / 86_400_000) + 1;
}

/** 表示する日数（手で直した値があればそれ、無ければ自動）。出せなければ null */
export function effectiveDayCount(from: string, to: string, override: number | null): number | null {
    if (override != null && Number.isFinite(override) && override >= 0) return Math.trunc(override);
    return countDaysInclusive(from, to);
}

/** 令和の 年・月・日（「令和　年　月　日」の枠に別々に入れる用）。空・不正なら全部 null */
export interface ReiwaParts {
    year: number | null;
    month: number | null;
    day: number | null;
}

export function reiwaParts(ymd: string): ReiwaParts {
    if (!isValidYmd(ymd)) return { year: null, month: null, day: null };
    return {
        year: toReiwaYear(Number(ymd.slice(0, 4))),
        month: Number(ymd.slice(5, 7)),
        day: Number(ymd.slice(8, 10)),
    };
}

/** 全角スペース（様式の空欄） */
export const BLANK = '　';

/** 'YYYY-MM-DD' → '令和8年9月5日'。空・不正なら「令和　年　月　日」 */
export function formatReiwaYmdOrBlank(ymd: string): string {
    if (!isValidYmd(ymd)) return `令和${BLANK}年${BLANK}月${BLANK}日`;
    return toReiwaYmd(ymd);
}

/** 「令和8年9月5日から令和8年10月4日まで」（空は空欄のまま） */
export function formatReiwaRange(from: string, to: string): string {
    return `${formatReiwaYmdOrBlank(from)}から${formatReiwaYmdOrBlank(to)}まで`;
}

/** 'HH:mm' → '9時' / '17時' / '9時30分'。空・不正なら「　時」 */
export function formatHourLabel(time: string): string {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return `${BLANK}時`;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (!Number.isInteger(h) || h < 0 || h > 24 || !Number.isInteger(mi) || mi < 0 || mi > 59) return `${BLANK}時`;
    return mi === 0 ? `${h}時` : `${h}時${mi}分`;
}

/** 数量（文字）→ 数。空・不正なら null */
export function parseQuantity(quantity: string): number | null {
    const t = quantity.trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 「約○㎡」の数（自動）。数量を切り上げた整数。出せなければ '' */
export function approxAreaOf(quantity: string): string {
    const n = parseQuantity(quantity);
    if (n == null) return '';
    return String(Math.ceil(n - 1e-9));
}

/** 表示する「約○㎡」の数（手で直した値があればそれ、無ければ自動） */
export function effectiveApproxArea(quantity: string, override: string | null): string {
    if (override != null) return override;
    return approxAreaOf(quantity);
}
