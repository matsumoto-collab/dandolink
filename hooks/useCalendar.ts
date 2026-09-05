import { useState, useMemo, useCallback } from 'react';
import { WeekDay, CalendarEvent } from '@/types/calendar';
import { getWeekDays, addWeeks, addDays, addMonths, isSameDay } from '@/utils/dateUtils';

interface UseCalendarReturn {
    currentDate: Date;
    weekDays: WeekDay[];
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToPreviousDay: () => void;
    goToNextDay: () => void;
    goToPreviousMonth: () => void;
    goToNextMonth: () => void;
    goToToday: () => void;
    goToDate: (date: Date) => void;
    setEvents: (events: CalendarEvent[]) => void;
}

/**
 * 指定した日付から週の月曜日を取得
 * @param date 基準となる日付
 * @returns その週の月曜日
 */
function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    // 日曜日(0)の場合は-6、それ以外は1-dayで月曜日に調整
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

/**
 * カレンダーのロジックを管理するカスタムフック
 */
export function useCalendar(initialEvents: CalendarEvent[] = []): UseCalendarReturn {
    // 初期値は今週の月曜日
    const [currentDate, setCurrentDate] = useState<Date>(() => getMonday(new Date()));
    const [events, setEventsState] = useState<CalendarEvent[]>(initialEvents);

    // 現在の週の日付を取得
    const weekDays = useMemo(() => {
        const days = getWeekDays(currentDate);

        // 各日付にイベントを割り当て
        return days.map(day => ({
            ...day,
            events: events.filter(event => isSameDay(event.startDate, day.date)),
        }));
    }, [currentDate, events]);

    // 移動系はすべて useCallback で参照を固定する。
    // 親（MainContent）が onNavigationReady で受け取った関数を state に入れているため、
    // 毎レンダー新しい関数を渡すと不要な再レンダーが連鎖する。
    // setCurrentDate の関数形式を使うので依存配列は空でよい。

    // 前の週へ移動
    const goToPreviousWeek = useCallback(() => {
        setCurrentDate(prevDate => addWeeks(prevDate, -1));
    }, []);

    // 次の週へ移動
    const goToNextWeek = useCallback(() => {
        setCurrentDate(prevDate => addWeeks(prevDate, 1));
    }, []);

    // 前の日へ移動
    const goToPreviousDay = useCallback(() => {
        setCurrentDate(prevDate => addDays(prevDate, -1));
    }, []);

    // 次の日へ移動
    const goToNextDay = useCallback(() => {
        setCurrentDate(prevDate => addDays(prevDate, 1));
    }, []);

    // 1ヶ月前へ移動（移動先の日付を含む週の月曜日にスナップ）
    const goToPreviousMonth = useCallback(() => {
        setCurrentDate(prevDate => getMonday(addMonths(prevDate, -1)));
    }, []);

    // 1ヶ月後へ移動（移動先の日付を含む週の月曜日にスナップ）
    const goToNextMonth = useCallback(() => {
        setCurrentDate(prevDate => getMonday(addMonths(prevDate, 1)));
    }, []);

    // 今週へ戻る（今週の月曜日に移動）
    const goToToday = useCallback(() => {
        setCurrentDate(getMonday(new Date()));
    }, []);

    // 任意の日付を含む週へ移動（その日付の週の月曜日にスナップ）
    const goToDate = useCallback((date: Date) => {
        setCurrentDate(getMonday(date));
    }, []);

    // イベントを設定
    const setEvents = useCallback((newEvents: CalendarEvent[]) => {
        setEventsState(newEvents);
    }, []);

    return {
        currentDate,
        weekDays,
        goToPreviousWeek,
        goToNextWeek,
        goToPreviousDay,
        goToNextDay,
        goToPreviousMonth,
        goToNextMonth,
        goToToday,
        goToDate,
        setEvents,
    };
}
