import {
    formatDateKey,
    getUnassignedEventCount,
} from '@/utils/employeeUtils';
import { CalendarEvent } from '@/types/calendar';

describe('employeeUtils', () => {
    describe('formatDateKey', () => {
        it('should format date as YYYY-MM-DD', () => {
            const date = new Date(2026, 0, 15); // 2026年1月15日
            expect(formatDateKey(date)).toBe('2026-01-15');
        });

        it('should pad single digit month and day with zeros', () => {
            const date = new Date(2026, 0, 5); // 2026年1月5日
            expect(formatDateKey(date)).toBe('2026-01-05');
        });

        it('should handle December correctly', () => {
            const date = new Date(2026, 11, 25); // 2026年12月25日
            expect(formatDateKey(date)).toBe('2026-12-25');
        });

        it('should handle February 29 in leap year', () => {
            const date = new Date(2028, 1, 29); // 2028年2月29日（うるう年）
            expect(formatDateKey(date)).toBe('2028-02-29');
        });
    });

    describe('getUnassignedEventCount', () => {
        const createEvent = (id: string, assignedEmployeeId: string, startDate: Date): CalendarEvent => ({
            id,
            title: `Event ${id}`,
            startDate,
            endDate: startDate,
            assignedEmployeeId,
            color: '#3B82F6',
        });

        it('should return 0 when no events are unassigned', () => {
            const events: CalendarEvent[] = [
                createEvent('1', 'employee-1', new Date(2026, 0, 15)),
                createEvent('2', 'employee-2', new Date(2026, 0, 15)),
            ];
            const count = getUnassignedEventCount(events, new Date(2026, 0, 15));
            expect(count).toBe(0);
        });

        it('should count unassigned events for the specified date', () => {
            const targetDate = new Date(2026, 0, 15);
            const events: CalendarEvent[] = [
                createEvent('1', 'unassigned', targetDate),
                createEvent('2', 'unassigned', targetDate),
                createEvent('3', 'employee-1', targetDate),
            ];
            const count = getUnassignedEventCount(events, targetDate);
            expect(count).toBe(2);
        });

        it('should not count unassigned events from different dates', () => {
            const targetDate = new Date(2026, 0, 15);
            const differentDate = new Date(2026, 0, 16);
            const events: CalendarEvent[] = [
                createEvent('1', 'unassigned', targetDate),
                createEvent('2', 'unassigned', differentDate),
            ];
            const count = getUnassignedEventCount(events, targetDate);
            expect(count).toBe(1);
        });

        it('should return 0 for empty events array', () => {
            const count = getUnassignedEventCount([], new Date(2026, 0, 15));
            expect(count).toBe(0);
        });
    });
});
