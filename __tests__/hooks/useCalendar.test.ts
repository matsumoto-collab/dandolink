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
                vehicles: [],
                confirmedWorkerIds: [],
                confirmedVehicleIds: [],
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: '2',
                title: 'Event 2',
                startDate: new Date('2024-01-16T10:00:00.000Z'), // Tuesday
                color: '#fff',
                category: 'construction',
                workers: [],
                trucks: [],
                vehicles: [],
                confirmedWorkerIds: [],
                confirmedVehicleIds: [],
                createdAt: new Date(),
                updatedAt: new Date()
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
                vehicles: [],
                confirmedWorkerIds: [],
                confirmedVehicleIds: [],
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        act(() => {
            result.current.setEvents(newEvents);
        });

        expect(result.current.weekDays[0].events).toHaveLength(1);
        expect(result.current.weekDays[0].events[0].title).toBe('New Event');
    });
});
