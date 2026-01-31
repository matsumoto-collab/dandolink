import { WeekDay } from '@/types/calendar';

/**
 * 日本の祝日データ (2024-2026年)
 * キー: "YYYY-MM-DD" 形式
 */
const JAPANESE_HOLIDAYS: Record<string, string> = {
    // 2024年
    '2024-01-01': '元日',
    '2024-01-08': '成人の日',
    '2024-02-11': '建国記念の日',
    '2024-02-12': '振替休日',
    '2024-02-23': '天皇誕生日',
    '2024-03-20': '春分の日',
    '2024-04-29': '昭和の日',
    '2024-05-03': '憲法記念日',
    '2024-05-04': 'みどりの日',
    '2024-05-05': 'こどもの日',
    '2024-05-06': '振替休日',
    '2024-07-15': '海の日',
    '2024-08-11': '山の日',
    '2024-08-12': '振替休日',
    '2024-09-16': '敬老の日',
    '2024-09-22': '秋分の日',
    '2024-09-23': '振替休日',
    '2024-10-14': 'スポーツの日',
    '2024-11-03': '文化の日',
    '2024-11-04': '振替休日',
    '2024-11-23': '勤労感謝の日',
    // 2025年
    '2025-01-01': '元日',
    '2025-01-13': '成人の日',
    '2025-02-11': '建国記念の日',
    '2025-02-23': '天皇誕生日',
    '2025-02-24': '振替休日',
    '2025-03-20': '春分の日',
    '2025-04-29': '昭和の日',
    '2025-05-03': '憲法記念日',
    '2025-05-04': 'みどりの日',
    '2025-05-05': 'こどもの日',
    '2025-05-06': '振替休日',
    '2025-07-21': '海の日',
    '2025-08-11': '山の日',
    '2025-09-15': '敬老の日',
    '2025-09-23': '秋分の日',
    '2025-10-13': 'スポーツの日',
    '2025-11-03': '文化の日',
    '2025-11-23': '勤労感謝の日',
    '2025-11-24': '振替休日',
    // 2026年
    '2026-01-01': '元日',
    '2026-01-12': '成人の日',
    '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日',
    '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日',
    '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日',
    '2026-05-06': '振替休日',
    '2026-07-20': '海の日',
    '2026-08-11': '山の日',
    '2026-09-21': '敬老の日',
    '2026-09-22': '国民の休日',
    '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日',
    '2026-11-23': '勤労感謝の日',
};

/**
 * 日付を "YYYY-MM-DD" 形式の文字列に変換
 */
function toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 祝日かどうかを判定
 * @param date 判定する日付
 * @returns 祝日の場合true
 */
export function isHoliday(date: Date): boolean {
    return toDateKey(date) in JAPANESE_HOLIDAYS;
}

/**
 * 祝日名を取得
 * @param date 日付
 * @returns 祝日名（祝日でない場合はnull）
 */
export function getHolidayName(date: Date): string | null {
    return JAPANESE_HOLIDAYS[toDateKey(date)] || null;
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
