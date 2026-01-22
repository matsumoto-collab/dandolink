import { useState, useMemo } from 'react';
import { WeekDay, CalendarEvent } from '@/types/calendar';
import { getWeekDays, addWeeks, addDays, isSameDay } from '@/utils/dateUtils';

interface UseCalendarReturn {
    currentDate: Date;
    weekDays: WeekDay[];
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToPreviousDay: () => void;
    goToNextDay: () => void;
    goToToday: () => void;
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

    // 前の週へ移動
    const goToPreviousWeek = () => {
        setCurrentDate(prevDate => addWeeks(prevDate, -1));
    };

    // 次の週へ移動
    const goToNextWeek = () => {
        setCurrentDate(prevDate => addWeeks(prevDate, 1));
    };

    // 前の日へ移動
    const goToPreviousDay = () => {
        setCurrentDate(prevDate => addDays(prevDate, -1));
    };

    // 次の日へ移動
    const goToNextDay = () => {
        setCurrentDate(prevDate => addDays(prevDate, 1));
    };

    // 今週へ戻る（今週の月曜日に移動）
    const goToToday = () => {
        setCurrentDate(getMonday(new Date()));
    };

    // イベントを設定
    const setEvents = (newEvents: CalendarEvent[]) => {
        setEventsState(newEvents);
    };

    return {
        currentDate,
        weekDays,
        goToPreviousWeek,
        goToNextWeek,
        goToPreviousDay,
        goToNextDay,
        goToToday,
        setEvents,
    };
}
