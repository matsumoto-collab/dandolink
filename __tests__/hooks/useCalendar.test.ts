import { renderHook, act } from '@testing-library/react';
import { useCalendar } from '@/hooks/useCalendar';
import { CalendarEvent } from '@/types/calendar';

describe('useCalendar', () => {
    const createEvent = (id: string, startDate: Date): CalendarEvent => ({
        id,
        title: `Event ${id}`,
        startDate,
        endDate: startDate,
        assignedEmployeeId: 'employee-1',
        category: 'construction',
        color: '#3B82F6',
    });

    // 今週の月曜日を取得するヘルパー
    const getMonday = (date: Date): Date => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
    };

    describe('initialization', () => {
        it('should initialize with Monday of current week', () => {
            const { result } = renderHook(() => useCalendar());
            const monday = getMonday(new Date());

            expect(result.current.currentDate.getDate()).toBe(monday.getDate());
            expect(result.current.currentDate.getMonth()).toBe(monday.getMonth());
            expect(result.current.currentDate.getFullYear()).toBe(monday.getFullYear());
        });

        it('should return 7 week days', () => {
            const { result } = renderHook(() => useCalendar());
            expect(result.current.weekDays).toHaveLength(7);
        });

        it('should initialize with provided events', () => {
            const today = new Date();
            const events = [createEvent('1', today)];
            const { result } = renderHook(() => useCalendar(events));

            // Find today in weekDays
            const todayDay = result.current.weekDays.find(
                day => day.date.getDate() === today.getDate()
            );
            expect(todayDay?.events).toHaveLength(1);
        });
    });

    describe('navigation', () => {
        it('should go to next week', () => {
            const { result } = renderHook(() => useCalendar());
            const initialDate = result.current.currentDate.getDate();

            act(() => {
                result.current.goToNextWeek();
            });

            expect(result.current.currentDate.getDate()).not.toBe(initialDate);
        });

        it('should go to previous week', () => {
            const { result } = renderHook(() => useCalendar());
            const initialDate = result.current.currentDate.getDate();

            act(() => {
                result.current.goToPreviousWeek();
            });

            expect(result.current.currentDate.getDate()).not.toBe(initialDate);
        });

        it('should go to next day', () => {
            const { result } = renderHook(() => useCalendar());
            const initialDate = result.current.currentDate.getDate();

            act(() => {
                result.current.goToNextDay();
            });

            // Handle month boundary
            const newDate = result.current.currentDate.getDate();
            expect(newDate === initialDate + 1 || newDate === 1).toBe(true);
        });

        it('should go to previous day', () => {
            const { result } = renderHook(() => useCalendar());

            // Move forward first to avoid month boundary issues
            act(() => {
                result.current.goToNextDay();
            });

            const initialDate = result.current.currentDate.getDate();

            act(() => {
                result.current.goToPreviousDay();
            });

            const newDate = result.current.currentDate.getDate();
            expect(newDate === initialDate - 1 || newDate >= 28).toBe(true);
        });

        it('should go to Monday of current week', () => {
            const { result } = renderHook(() => useCalendar());
            const monday = getMonday(new Date());

            // Move to next week first
            act(() => {
                result.current.goToNextWeek();
            });

            // Then go back to today (returns Monday of current week)
            act(() => {
                result.current.goToToday();
            });

            expect(result.current.currentDate.getDate()).toBe(monday.getDate());
        });
    });

    describe('setEvents', () => {
        it('should update events', () => {
            const { result } = renderHook(() => useCalendar());
            const today = new Date();
            const newEvents = [
                createEvent('1', today),
                createEvent('2', today),
            ];

            act(() => {
                result.current.setEvents(newEvents);
            });

            const todayDay = result.current.weekDays.find(
                day => day.date.getDate() === today.getDate()
            );
            expect(todayDay?.events).toHaveLength(2);
        });

        it('should filter events by date', () => {
            const { result } = renderHook(() => useCalendar());
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const events = [
                createEvent('1', today),
                createEvent('2', tomorrow),
            ];

            act(() => {
                result.current.setEvents(events);
            });

            const todayDay = result.current.weekDays.find(
                day => day.date.getDate() === today.getDate()
            );
            expect(todayDay?.events).toHaveLength(1);
            expect(todayDay?.events[0].id).toBe('1');
        });
    });
});
