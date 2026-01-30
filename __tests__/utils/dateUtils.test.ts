import {
    formatDate,
    getDayOfWeekString,
    getWeekDays,
    getWeekRangeString,
    isSameDay,
    addDays,
    isToday,
    addWeeks,
    getFirstDayOfMonth,
    getLastDayOfMonth,
} from '@/utils/dateUtils';

describe('dateUtils', () => {
    describe('formatDate', () => {
        it('should format date as full format (YYYY年M月D日)', () => {
            const date = new Date(2026, 0, 15); // 2026年1月15日
            expect(formatDate(date, 'full')).toBe('2026年1月15日');
        });

        it('should format date as short format (M/D)', () => {
            const date = new Date(2026, 0, 15);
            expect(formatDate(date, 'short')).toBe('1/15');
        });

        it('should format date as month format (YYYY年M月)', () => {
            const date = new Date(2026, 0, 15);
            expect(formatDate(date, 'month')).toBe('2026年1月');
        });

        it('should format date as day format (D)', () => {
            const date = new Date(2026, 0, 15);
            expect(formatDate(date, 'day')).toBe('15');
        });
    });

    describe('getDayOfWeekString', () => {
        it('should return long day of week string', () => {
            const monday = new Date(2026, 0, 12); // 2026年1月12日（月曜日）
            expect(getDayOfWeekString(monday, 'long')).toBe('月曜日');
        });

        it('should return short day of week string', () => {
            const monday = new Date(2026, 0, 12);
            expect(getDayOfWeekString(monday, 'short')).toBe('月');
        });

        it('should default to long format', () => {
            const monday = new Date(2026, 0, 12);
            expect(getDayOfWeekString(monday)).toBe('月曜日');
        });
    });

    describe('isSameDay', () => {
        it('should return true for same dates', () => {
            const date1 = new Date(2026, 0, 15, 10, 30);
            const date2 = new Date(2026, 0, 15, 15, 45);
            expect(isSameDay(date1, date2)).toBe(true);
        });

        it('should return false for different dates', () => {
            const date1 = new Date(2026, 0, 15);
            const date2 = new Date(2026, 0, 16);
            expect(isSameDay(date1, date2)).toBe(false);
        });

        it('should return false for different months', () => {
            const date1 = new Date(2026, 0, 15);
            const date2 = new Date(2026, 1, 15);
            expect(isSameDay(date1, date2)).toBe(false);
        });
    });

    describe('addDays', () => {
        it('should add positive days', () => {
            const date = new Date(2026, 0, 15);
            const result = addDays(date, 5);
            expect(result.getDate()).toBe(20);
        });

        it('should handle negative days', () => {
            const date = new Date(2026, 0, 15);
            const result = addDays(date, -5);
            expect(result.getDate()).toBe(10);
        });

        it('should handle month overflow', () => {
            const date = new Date(2026, 0, 30);
            const result = addDays(date, 5);
            expect(result.getMonth()).toBe(1); // February
            expect(result.getDate()).toBe(4);
        });

        it('should not modify the original date', () => {
            const date = new Date(2026, 0, 15);
            addDays(date, 5);
            expect(date.getDate()).toBe(15);
        });
    });

    describe('addWeeks', () => {
        it('should add weeks correctly', () => {
            const date = new Date(2026, 0, 12);
            const result = addWeeks(date, 2);
            expect(result.getDate()).toBe(26);
        });

        it('should handle negative weeks', () => {
            const date = new Date(2026, 0, 26);
            const result = addWeeks(date, -1);
            expect(result.getDate()).toBe(19);
        });
    });

    describe('isToday', () => {
        it('should return true for today', () => {
            const today = new Date();
            expect(isToday(today)).toBe(true);
        });

        it('should return false for yesterday', () => {
            const yesterday = addDays(new Date(), -1);
            expect(isToday(yesterday)).toBe(false);
        });
    });

    describe('getWeekDays', () => {
        it('should return 7 days starting from the given date', () => {
            const startDate = new Date(2026, 0, 12);
            const weekDays = getWeekDays(startDate);
            expect(weekDays).toHaveLength(7);
            expect(weekDays[0].date.getDate()).toBe(12);
            expect(weekDays[6].date.getDate()).toBe(18);
        });

        it('should correctly set dayOfWeek', () => {
            const monday = new Date(2026, 0, 12); // Monday
            const weekDays = getWeekDays(monday);
            expect(weekDays[0].dayOfWeek).toBe(1); // Monday
            expect(weekDays[6].dayOfWeek).toBe(0); // Sunday
        });

        it('should correctly mark weekends', () => {
            const monday = new Date(2026, 0, 12);
            const weekDays = getWeekDays(monday);

            // Monday to Friday should not be weekend
            expect(weekDays[0].isWeekend).toBe(false);
            expect(weekDays[4].isWeekend).toBe(false);

            // Saturday and Sunday should be weekend
            expect(weekDays[5].isWeekend).toBe(true);
            expect(weekDays[6].isWeekend).toBe(true);
        });
    });

    describe('getWeekRangeString', () => {
        it('should return week range string for same month', () => {
            const startDate = new Date(2026, 0, 12);
            const weekDays = getWeekDays(startDate);
            const rangeString = getWeekRangeString(weekDays);
            expect(rangeString).toBe('2026年1月12日〜18日');
        });

        it('should return empty string for empty array', () => {
            const rangeString = getWeekRangeString([]);
            expect(rangeString).toBe('');
        });

        it('should return full format for cross-month week', () => {
            const startDate = new Date(2026, 0, 28); // Jan 28
            const weekDays = getWeekDays(startDate); // Jan 28 - Feb 3
            const rangeString = getWeekRangeString(weekDays);
            expect(rangeString).toBe('2026年1月28日〜2026年2月3日');
        });
    });

    describe('getFirstDayOfMonth', () => {
        it('should return first day of the month', () => {
            const date = new Date(2026, 0, 15);
            const firstDay = getFirstDayOfMonth(date);
            expect(firstDay.getDate()).toBe(1);
            expect(firstDay.getMonth()).toBe(0);
            expect(firstDay.getFullYear()).toBe(2026);
        });

        it('should handle different months', () => {
            const date = new Date(2026, 5, 20); // June 20
            const firstDay = getFirstDayOfMonth(date);
            expect(firstDay.getDate()).toBe(1);
            expect(firstDay.getMonth()).toBe(5);
        });
    });

    describe('getLastDayOfMonth', () => {
        it('should return last day of January (31 days)', () => {
            const date = new Date(2026, 0, 15);
            const lastDay = getLastDayOfMonth(date);
            expect(lastDay.getDate()).toBe(31);
            expect(lastDay.getMonth()).toBe(0);
        });

        it('should return last day of February (28 days)', () => {
            const date = new Date(2026, 1, 15);
            const lastDay = getLastDayOfMonth(date);
            expect(lastDay.getDate()).toBe(28);
        });

        it('should return last day of February in leap year (29 days)', () => {
            const date = new Date(2028, 1, 15); // 2028 is leap year
            const lastDay = getLastDayOfMonth(date);
            expect(lastDay.getDate()).toBe(29);
        });

        it('should return last day of April (30 days)', () => {
            const date = new Date(2026, 3, 15);
            const lastDay = getLastDayOfMonth(date);
            expect(lastDay.getDate()).toBe(30);
        });
    });
});
