import { renderHook, act } from '@testing-library/react';
import { useCalendar } from '@/hooks/useCalendar';
import { CalendarEvent } from '@/types/calendar';

describe('useCalendar', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // Set a fixed date: 2024-01-15 (Monday)
        jest.setSystemTime(new Date('2024-01-15T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should initialize with current week Monday', () => {
        const { result } = renderHook(() => useCalendar());

        // 2024-01-15 is Monday, so it should be the current date
        expect(result.current.currentDate.toISOString()).toContain('2024-01-15');
    });

    it('should navigate to next week', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToNextWeek();
        });

        // 2024-01-15 + 7 days = 2024-01-22
        expect(result.current.currentDate.toISOString()).toContain('2024-01-22');
    });

    it('should navigate to previous week', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToPreviousWeek();
        });

        // 2024-01-15 - 7 days = 2024-01-08
        expect(result.current.currentDate.toISOString()).toContain('2024-01-08');
    });

    it('should navigate to next day', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToNextDay();
        });

        // 2024-01-15 + 1 day = 2024-01-16
        expect(result.current.currentDate.toISOString()).toContain('2024-01-16');
    });

    it('should navigate to previous day', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToPreviousDay();
        });

        // 2024-01-15 - 1 day = 2024-01-14
        expect(result.current.currentDate.toISOString()).toContain('2024-01-14');
    });

    it('should return to today', () => {
        const { result } = renderHook(() => useCalendar());

        // Move to somewhere else first
        act(() => {
            result.current.goToNextWeek();
        });
        expect(result.current.currentDate.toISOString()).toContain('2024-01-22');

        act(() => {
            result.current.goToToday();
        });

        // Should be back to 2024-01-15 (mocked system time)
        expect(result.current.currentDate.toISOString()).toContain('2024-01-15');
    });

    it('should navigate to next month (snapped to the Monday of that week)', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToNextMonth();
        });

        // 2024-01-15 + 1ヶ月 = 2024-02-15(木) → その週の月曜 = 2024-02-12
        expect(result.current.currentDate.getFullYear()).toBe(2024);
        expect(result.current.currentDate.getMonth()).toBe(1);
        expect(result.current.currentDate.getDate()).toBe(12);
    });

    it('should navigate to previous month (snapped to the Monday of that week)', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToPreviousMonth();
        });

        // 2024-01-15 - 1ヶ月 = 2023-12-15(金) → その週の月曜 = 2023-12-11
        expect(result.current.currentDate.getFullYear()).toBe(2023);
        expect(result.current.currentDate.getMonth()).toBe(11);
        expect(result.current.currentDate.getDate()).toBe(11);
    });

    it('should jump to an arbitrary date snapped to Monday', () => {
        const { result } = renderHook(() => useCalendar());

        act(() => {
            result.current.goToDate(new Date('2024-03-07T00:00:00.000Z'));
        });

        // 2024-03-07(木) → その週の月曜 = 2024-03-04
        expect(result.current.currentDate.getFullYear()).toBe(2024);
        expect(result.current.currentDate.getMonth()).toBe(2);
        expect(result.current.currentDate.getDate()).toBe(4);
    });

    it('should keep navigation function references stable across renders', () => {
        const { result, rerender } = renderHook(() => useCalendar());

        const before = {
            goToNextWeek: result.current.goToNextWeek,
            goToPreviousWeek: result.current.goToPreviousWeek,
            goToNextMonth: result.current.goToNextMonth,
            goToPreviousMonth: result.current.goToPreviousMonth,
            goToToday: result.current.goToToday,
            goToDate: result.current.goToDate,
        };

        rerender();

        expect(result.current.goToNextWeek).toBe(before.goToNextWeek);
        expect(result.current.goToPreviousWeek).toBe(before.goToPreviousWeek);
        expect(result.current.goToNextMonth).toBe(before.goToNextMonth);
        expect(result.current.goToPreviousMonth).toBe(before.goToPreviousMonth);
        expect(result.current.goToToday).toBe(before.goToToday);
        expect(result.current.goToDate).toBe(before.goToDate);
    });

    it('should calculate weekDays correctly', () => {
        const { result } = renderHook(() => useCalendar());

        // Default implementation typically returns 7 days starting from current date (which is Monday)
        expect(result.current.weekDays).toHaveLength(7);
        expect(result.current.weekDays[0].date.toISOString()).toContain('2024-01-15'); // Mon
        expect(result.current.weekDays[6].date.toISOString()).toContain('2024-01-21'); // Sun
    });

    it('should filter events for weekDays', () => {
        const mockEvents: CalendarEvent[] = [
            {
                id: '1',
                title: 'Event 1',
                startDate: new Date('2024-01-15T10:00:00.000Z'), // Monday
                color: '#fff',
                category: 'construction',
                workers: [],
                trucks: [],
            },
            {
                id: '2',
                title: 'Event 2',
                startDate: new Date('2024-01-16T10:00:00.000Z'), // Tuesday
                color: '#fff',
                category: 'construction',
                workers: [],
                trucks: [],
            }
        ];

        const { result } = renderHook(() => useCalendar(mockEvents));

        // Monday should have Event 1
        expect(result.current.weekDays[0].events).toHaveLength(1);
        expect(result.current.weekDays[0].events[0].id).toBe('1');

        // Tuesday should have Event 2
        expect(result.current.weekDays[1].events).toHaveLength(1);
        expect(result.current.weekDays[1].events[0].id).toBe('2');

        // Wednesday should have no events
        expect(result.current.weekDays[2].events).toHaveLength(0);
    });

    it('should update events via setEvents', () => {
        const { result } = renderHook(() => useCalendar());

        const newEvents: CalendarEvent[] = [
            {
                id: '1',
                title: 'New Event',
                startDate: new Date('2024-01-15T10:00:00.000Z'),
                color: '#fff',
                category: 'construction',
                workers: [],
                trucks: [],
            }
        ];

        act(() => {
            result.current.setEvents(newEvents);
        });

        expect(result.current.weekDays[0].events).toHaveLength(1);
        expect(result.current.weekDays[0].events[0].title).toBe('New Event');
    });
});
