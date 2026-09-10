import { WeekDay } from '@/types/calendar';
// 祝日は年に依存しない計算で求める（以前はここに2024〜2026年の手書きテーブルを置いていた）
import { getJapaneseHolidayName, isJapaneseHoliday } from '@/lib/japaneseHolidays';

/**
 * 祝日かどうかを判定
 * @param date 判定する日付
 * @returns 祝日の場合true
 */
export function isHoliday(date: Date): boolean {
    return isJapaneseHoliday(date);
}

/**
 * 祝日名を取得
 * @param date 日付
 * @returns 祝日名（祝日でない場合はnull）
 */
export function getHolidayName(date: Date): string | null {
    return getJapaneseHolidayName(date);
}

/**
 * 指定した日付から7日分の日付を取得
 * @param date 基準となる日付（表示開始日）
 * @returns 7日分の日付配列
 */
export function getWeekDays(date: Date): WeekDay[] {
    const weekDays: WeekDay[] = [];
    const startDate = new Date(date);

    // 指定された日付から7日分の日付を生成
    for (let i = 0; i < 7; i++) {
        const day = new Date(startDate);
        day.setDate(startDate.getDate() + i);
        const dayOfWeek = day.getDay();

        weekDays.push({
            date: day,
            dayOfWeek: dayOfWeek,
            isToday: isToday(day),
            isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
            isHoliday: isHoliday(day),
            events: [], // 初期状態では空の配列
        });
    }

    return weekDays;
}

/**
 * 日付をフォーマット
 * @param date 日付
 * @param format フォーマット形式
 * @returns フォーマットされた日付文字列
 */
export function formatDate(date: Date, format: 'full' | 'short' | 'month' | 'day' = 'full'): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    switch (format) {
        case 'full':
            return `${year}年${month}月${day}日`;
        case 'short':
            return `${month}/${day}`;
        case 'month':
            return `${year}年${month}月`;
        case 'day':
            return `${day}`;
        default:
            return `${year}年${month}月${day}日`;
    }
}

/**
 * 曜日を取得
 * @param date 日付
 * @param format フォーマット形式
 * @returns 曜日文字列
 */
export function getDayOfWeekString(date: Date, format: 'long' | 'short' = 'long'): string {
    const daysLong = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
    const daysShort = ['日', '月', '火', '水', '木', '金', '土'];

    const dayOfWeek = date.getDay();
    return format === 'long' ? daysLong[dayOfWeek] : daysShort[dayOfWeek];
}

/**
 * 今日かどうかを判定
 * @param date 判定する日付
 * @returns 今日の場合true
 */
export function isToday(date: Date): boolean {
    const today = new Date();
    return isSameDay(date, today);
}

/**
 * 同じ日かどうかを判定
 * @param date1 日付1
 * @param date2 日付2
 * @returns 同じ日の場合true
 */
export function isSameDay(date1: Date, date2: Date): boolean {
    return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
    );
}

/**
 * 週を加算/減算
 * @param date 基準となる日付
 * @param weeks 加算する週数（負の値で減算）
 * @returns 新しい日付
 */
export function addWeeks(date: Date, weeks: number): Date {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + weeks * 7);
    return newDate;
}

/**
 * 日を加算/減算
 * @param date 基準となる日付
 * @param days 加算する日数（負の値で減算）
 * @returns 新しい日付
 */
export function addDays(date: Date, days: number): Date {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    return newDate;
}

/**
 * 月を加算/減算
 * 月末は繰り上げずに丸める（例: 1/31 の +1ヶ月 → 2/29 or 2/28、3/31 の −1ヶ月 → 2/29）。
 * 時刻成分はそのまま維持する。
 * @param date 基準となる日付
 * @param months 加算する月数（負の値で減算）
 * @returns 新しい日付
 */
export function addMonths(date: Date, months: number): Date {
    const newDate = new Date(date);
    const day = newDate.getDate();
    // 先に1日へ寄せてから月を動かすことで、setMonth の繰り上がりを防ぐ
    newDate.setDate(1);
    newDate.setMonth(newDate.getMonth() + months);
    const lastDay = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate();
    newDate.setDate(Math.min(day, lastDay));
    return newDate;
}

/**
 * "HH:MM" 形式の開始/終了時刻から差分を分単位で算出。
 * 終了時刻が開始時刻より前の場合は翌日扱いで24時間を加算する（夜間作業対応）。
 * 不正な入力（NaN等）は0を返す。
 */
export function calcTimeDiffMinutes(startTime: string, endTime: string): number {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    if ([sh, sm, eh, em].some(v => Number.isNaN(v))) return 0;
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60;
    return diff;
}

/**
 * 月の最初の日を取得
 * @param date 基準となる日付
 * @returns 月の最初の日
 */
export function getFirstDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * 月の最後の日を取得
 * @param date 基準となる日付
 * @returns 月の最後の日
 */
export function getLastDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * 週の範囲を文字列で取得
 * @param weekDays 週の日付配列
 * @returns 週の範囲文字列（例: "2025年1月1日〜1月7日"）
 */
export function getWeekRangeString(weekDays: WeekDay[]): string {
    if (weekDays.length === 0) return '';

    const firstDay = weekDays[0].date;
    const lastDay = weekDays[weekDays.length - 1].date;

    const firstMonth = firstDay.getMonth() + 1;
    const lastMonth = lastDay.getMonth() + 1;
    const year = firstDay.getFullYear();

    if (firstMonth === lastMonth) {
        return `${year}年${firstMonth}月${firstDay.getDate()}日〜${lastDay.getDate()}日`;
    } else {
        return `${formatDate(firstDay, 'full')}〜${formatDate(lastDay, 'full')}`;
    }
}
