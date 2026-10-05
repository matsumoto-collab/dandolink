/**
 * 支払明細書の画面（一覧・編集・設定）で共通に使う小物。
 * 計算の式は lib/joyoStatement.ts に置き、ここには「表示の整え方」と「API の断りメッセージの取り出し」だけを置く。
 */
import type { JoyoStatementStatus } from '@/types/joyoStatement';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 今日（JST）の 'YYYY-MM-DD'（app/(finance)/order-backlog/page.tsx の todayJst と同じ考え方） */
export function todayJst(): string {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

/** 最初に開く月＝先月（JST）。月末締め・翌月10日払いなので、先月分を作ることが多いため */
export function previousMonthJst(): { year: number; month: number } {
    const [y, m] = todayJst().split('-').map(Number);
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

/** 金額の表示（¥12,345）。マイナスは -¥1,000 */
export function yen(n: number): string {
    const v = Math.round(n);
    return `${v < 0 ? '-' : ''}¥${Math.abs(v).toLocaleString('ja-JP')}`;
}

/** 金額の表示（1,500円）。本人の画面用。マイナスは -1,000円 */
export function yenJa(n: number): string {
    const v = Math.round(n);
    return `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('ja-JP')}円`;
}

/** 'YYYY-MM-DD' → '2026年9月30日'（形が違えばそのまま） */
export function formatYmdJa(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → '9/14' */
export function formatMd(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    return `${Number(m[2])}/${Number(m[3])}`;
}

/** 'YYYY-MM-DD' → '9/14（月）' */
export function formatMdWeek(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return `${Number(m[2])}/${Number(m[3])}（${WEEK[dow]}）`;
}

/** 'YYYY-MM-DD' として実在する日か（2026-02-31 を通さない。API の検証と同じ考え方） */
export function isValidYmd(ymd: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const d = new Date(`${ymd}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/** 状態の印（一覧と編集画面で同じ色にする） */
export type JoyoRowState = 'none' | JoyoStatementStatus;

export const JOYO_STATE_META: Record<JoyoRowState, { label: string; className: string }> = {
    none: { label: '未作成', className: 'bg-slate-100 text-slate-600 border-slate-200' },
    draft: { label: '下書き', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    issued: { label: '発行済み', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/**
 * API の断りメッセージ（{ error }）を取り出す。無ければ fallback。
 * 保存などが断られたときは、サーバーのメッセージをそのままトーストに出すため。
 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = await res.json();
        return typeof body?.error === 'string' && body.error ? body.error : fallback;
    } catch {
        return fallback;
    }
}
