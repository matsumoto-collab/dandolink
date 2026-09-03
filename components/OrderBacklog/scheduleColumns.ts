/**
 * 画面の入金予定 9 列（円）と ScheduleMap の相互変換。
 *
 * 保存形（ScheduleMap）は 'YYYY-MM' か 'later' をキーに持つが、基準日を変えると列がずれて
 * 「表に出ていない月の金額」が生まれる。出力（lib/orderBacklog/render.ts）と同じ寄せ方
 * ——基準月より前は第1列、基準月+8 以降は最終列（'later'）——を画面でも使い、
 * 編集したときは寄せ先の元キーごと差し替えて、表の見た目と保存値を一致させる。
 */
import { ymDiff, ymOf, type MonthColumn } from '@/lib/orderBacklog/render';
import { SCHEDULE_COLUMN_COUNT, type ScheduleMap } from '@/lib/orderBacklog/types';

/** ScheduleMap のキーが 9 列のどこに入るか（0〜8）。 */
export function columnIndexForKey(key: string, baseYm: string): number {
    const last = SCHEDULE_COLUMN_COUNT - 1;
    if (key === 'later') return last;
    const diff = ymDiff(ymOf(key), baseYm);
    return diff <= 0 ? 0 : Math.min(diff, last);
}

/** ScheduleMap（円）→ 9 列（円）。列に寄せた合計。 */
export function foldScheduleToColumns(
    schedule: ScheduleMap | null | undefined,
    baseYm: string,
): number[] {
    const out = new Array<number>(SCHEDULE_COLUMN_COUNT).fill(0);
    for (const [key, amount] of Object.entries(schedule ?? {})) {
        if (!amount) continue;
        out[columnIndexForKey(key, baseYm)] += amount;
    }
    return out;
}

/**
 * 9 列の 1 つを編集した ScheduleMap を返す（元の ScheduleMap は変更しない）。
 * その列に寄せられていた元キーは全て消してから列のキーで入れ直す＝二重計上しない。
 */
export function setScheduleColumn(
    schedule: ScheduleMap | null | undefined,
    columns: MonthColumn[],
    index: number,
    amount: number,
): ScheduleMap {
    const baseYm = columns[0]?.key ?? '';
    const next: ScheduleMap = {};
    for (const [key, value] of Object.entries(schedule ?? {})) {
        if (columnIndexForKey(key, baseYm) === index) continue;
        if (!value) continue;
        next[key] = value;
    }
    const columnKey = columns[index]?.key;
    if (columnKey && amount > 0) next[columnKey] = amount;
    return next;
}

/** 入金予定の合計（円）。行合計と未受領のズレ表示に使う。 */
export function scheduleTotal(schedule: ScheduleMap | null | undefined): number {
    return Object.values(schedule ?? {}).reduce((sum, v) => sum + (v || 0), 0);
}
