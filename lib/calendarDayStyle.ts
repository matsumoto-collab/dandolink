/**
 * 週間カレンダーの「曜日ごとの色」。土曜＝青、日曜と祝日＝赤で統一する。
 *
 * これまでは土日とも `bg-slate-50/40` で、色の上では平日とほとんど区別が付かなかった
 * （kei報告 2026-09-10「土曜と日曜の列をもっと目で見て分かりやすく」）。
 * ヘッダー・職長セル・浮きレーン・備考行・残り人数行がバラバラの指定を持っていたので、
 * 色はここに集約して各所はこの定数を参照する。
 *
 * Tailwind はクラス名を静的に走査するので、文字列を組み立てず完成形で持つこと。
 */

export type CalendarDayKind = 'weekday' | 'saturday' | 'holiday';

/** 日曜と祝日は同じ「休み」の扱い（赤）にする */
export function getCalendarDayKind(day: { dayOfWeek: number; isHoliday?: boolean }): CalendarDayKind {
    if (day.dayOfWeek === 0 || day.isHoliday) return 'holiday';
    if (day.dayOfWeek === 6) return 'saturday';
    return 'weekday';
}

export interface CalendarDayStyle {
    /** 日付ヘッダーの背景 */
    headerBg: string;
    /** 日付ヘッダーの文字色 */
    headerText: string;
    /** 職長セル・浮きセルなど本文セルの背景 */
    cellBg: string;
    /** 本文セルの hover 背景（クリックできるセル用） */
    cellHover: string;
    /** 残り人数行・備考行など、本文より薄く敷く行の背景 */
    subRowBg: string;
    /**
     * 浮きレーン用。レーン自体が赤地なので、平日は色を足さず（''）、
     * 土日祝だけ薄く重ねて列の並びを職長行と揃える。
     */
    floatingBg: string;
}

export const CALENDAR_DAY_STYLE: Record<CalendarDayKind, CalendarDayStyle> = {
    weekday: {
        headerBg: 'bg-slate-100',
        headerText: 'text-slate-700',
        cellBg: 'bg-white',
        cellHover: 'hover:bg-slate-50/80',
        subRowBg: 'bg-white',
        floatingBg: '',
    },
    saturday: {
        headerBg: 'bg-sky-100',
        headerText: 'text-sky-700',
        cellBg: 'bg-sky-50/70',
        cellHover: 'hover:bg-sky-100/70',
        subRowBg: 'bg-sky-50/40',
        floatingBg: 'bg-sky-100/40',
    },
    holiday: {
        headerBg: 'bg-rose-100',
        headerText: 'text-rose-700',
        cellBg: 'bg-rose-50/70',
        cellHover: 'hover:bg-rose-100/70',
        subRowBg: 'bg-rose-50/40',
        floatingBg: 'bg-rose-100/50',
    },
};

export function getCalendarDayStyle(day: { dayOfWeek: number; isHoliday?: boolean }): CalendarDayStyle {
    return CALENDAR_DAY_STYLE[getCalendarDayKind(day)];
}
