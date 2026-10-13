/**
 * 道路申請の画面（一覧・編集）で共通に使う小物。
 * 表記の決まり（和暦・日数・面積）は lib/roadPermit/format.ts に置き、ここには「画面での見せ方」と
 * 「API の断りメッセージの取り出し」だけを置く。
 */
import type { RoadPermitStatus } from '@/types/roadPermit';
import { ROAD_PERMIT_STATUS_LABELS } from '@/types/roadPermit';
import { formatReiwaYmdOrBlank, isValidYmd } from '@/lib/roadPermit/format';

/** 入力欄の見た目（編集画面と「担当者の候補」の登録画面で同じにする） */
export const ROAD_PERMIT_INPUT_CLASS =
    'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 read-only:bg-slate-50 read-only:text-slate-700 disabled:bg-slate-100';

/** 状態のバッジの色（一覧と編集画面で同じにする）。下書き・完了は灰色、提出済み=青、許可済み=ティール、取りやめ=赤 */
export const ROAD_PERMIT_STATUS_BADGE: Record<RoadPermitStatus, string> = {
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    permitted: 'bg-teal-50 text-teal-700 border-teal-200',
    completed: 'bg-slate-100 text-slate-500 border-slate-200',
    canceled: 'bg-red-50 text-red-700 border-red-200',
};

export function statusLabel(status: RoadPermitStatus): string {
    return ROAD_PERMIT_STATUS_LABELS[status] ?? status;
}

/** 令和の日付。空・不正なら「—」（一覧用。様式の空欄「令和　年　月　日」は画面では見づらいため） */
export function reiwaOrDash(ymd: string | null | undefined): string {
    if (!ymd || !isValidYmd(ymd)) return '—';
    return formatReiwaYmdOrBlank(ymd);
}

/** 占用期間の表示。両方空なら「—」、片方だけなら空の側は「—」 */
export function formatUsePeriod(from: string, to: string): string {
    const hasFrom = !!from && isValidYmd(from);
    const hasTo = !!to && isValidYmd(to);
    if (!hasFrom && !hasTo) return '—';
    return `${reiwaOrDash(from)}〜${reiwaOrDash(to)}`;
}

/** ISO の日時 → 'YYYY/M/D'（日本時間）。形が違えば「—」 */
export function formatUpdatedDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/**
 * 日数の手入力（文字）→ 数。空なら null（＝自動に戻す）。数として読めなければ undefined（入力をそのまま待つ）。
 * input type=number はスマホで空になる事故があるため、文字で受けて読み取る。
 */
export function parseDayCountInput(text: string): number | null | undefined {
    const t = text.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (t === '') return null;
    if (!/^\d{1,4}$/.test(t)) return undefined;
    return Number(t);
}

/**
 * API の断りメッセージ（{ error }）を取り出す。無ければ fallback。
 * 保存などが断られたときは、サーバーのメッセージをそのままトーストに出すため（JoyoStatements/joyoUi.ts と同じ）。
 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = await res.json();
        return typeof body?.error === 'string' && body.error ? body.error : fallback;
    } catch {
        return fallback;
    }
}
