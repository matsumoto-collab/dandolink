import {
    formatDateKey,
    getUnassignedEventCount,
    generateEmployeeRows,
    getEventsForDate,
} from '@/utils/employeeUtils';
import { CalendarEvent, Employee, EmployeeRow } from '@/types/calendar';

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
            category: 'construction',
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

    describe('generateEmployeeRows', () => {
        const createEmployee = (id: string, name: string): Employee => ({
            id,
            name,
            nickname: null,
        });

        const createEvent = (id: string, assignedEmployeeId: string, startDate: Date, sortOrder = 0): CalendarEvent => ({
            id,
            title: `Event ${id}`,
            startDate,
            endDate: startDate,
            assignedEmployeeId,
            category: 'construction',
            color: '#3B82F6',
            sortOrder,
        });

        it('should generate rows for each employee', () => {
            const employees: Employee[] = [
                createEmployee('emp-1', 'Employee 1'),
                createEmployee('emp-2', 'Employee 2'),
            ];
            const events: CalendarEvent[] = [];
            const weekDays: never[] = [];

            const rows = generateEmployeeRows(employees, events, weekDays);

            expect(rows).toHaveLength(2);
            expect(rows[0].employeeId).toBe('emp-1');
            expect(rows[1].employeeId).toBe('emp-2');
        });

        it('should use nickname if available', () => {
            const employees: Employee[] = [
                { id: 'emp-1', name: 'Full Name', nickname: 'Nick' },
            ];
            const rows = generateEmployeeRows(employees, [], []);

            expect(rows[0].employeeName).toBe('Nick');
        });

        it('should use name if nickname is null', () => {
            const employees: Employee[] = [
                { id: 'emp-1', name: 'Full Name', nickname: null },
            ];
            const rows = generateEmployeeRows(employees, [], []);

            expect(rows[0].employeeName).toBe('Full Name');
        });

        it('should group events by date for each employee', () => {
            const employees: Employee[] = [createEmployee('emp-1', 'Employee 1')];
            const date1 = new Date(2026, 0, 15);
            const date2 = new Date(2026, 0, 16);
            const events: CalendarEvent[] = [
                createEvent('ev-1', 'emp-1', date1),
                createEvent('ev-2', 'emp-1', date1),
                createEvent('ev-3', 'emp-1', date2),
            ];

            const rows = generateEmployeeRows(employees, events, []);

            expect(rows[0].events.get('2026-01-15')).toHaveLength(2);
            expect(rows[0].events.get('2026-01-16')).toHaveLength(1);
        });

        it('should sort events by sortOrder', () => {
            const employees: Employee[] = [createEmployee('emp-1', 'Employee 1')];
            const date = new Date(2026, 0, 15);
            const events: CalendarEvent[] = [
                createEvent('ev-1', 'emp-1', date, 2),
                createEvent('ev-2', 'emp-1', date, 0),
                createEvent('ev-3', 'emp-1', date, 1),
            ];

            const rows = generateEmployeeRows(employees, events, []);
            const dayEvents = rows[0].events.get('2026-01-15')!;

            expect(dayEvents[0].id).toBe('ev-2');
            expect(dayEvents[1].id).toBe('ev-3');
            expect(dayEvents[2].id).toBe('ev-1');
        });

        it('should not include events from other employees', () => {
            const employees: Employee[] = [createEmployee('emp-1', 'Employee 1')];
            const date = new Date(2026, 0, 15);
            const events: CalendarEvent[] = [
                createEvent('ev-1', 'emp-1', date),
                createEvent('ev-2', 'emp-2', date),
            ];

            const rows = generateEmployeeRows(employees, events, []);
            const dayEvents = rows[0].events.get('2026-01-15')!;

            expect(dayEvents).toHaveLength(1);
            expect(dayEvents[0].id).toBe('ev-1');
        });
    });

    describe('getEventsForDate', () => {
        const createRow = (events: Map<string, CalendarEvent[]>): EmployeeRow => ({
            employeeId: 'emp-1',
            employeeName: 'Employee 1',
            rowIndex: 0,
            events,
        });

        const createEvent = (id: string): CalendarEvent => ({
            id,
            title: `Event ${id}`,
            startDate: new Date(2026, 0, 15),
            endDate: new Date(2026, 0, 15),
            assignedEmployeeId: 'emp-1',
            category: 'construction',
            color: '#3B82F6',
        });

        it('should return events for the specified date', () => {
            const eventsMap = new Map<string, CalendarEvent[]>();
            eventsMap.set('2026-01-15', [createEvent('ev-1'), createEvent('ev-2')]);
            const row = createRow(eventsMap);

            const result = getEventsForDate(row, new Date(2026, 0, 15));

            expect(result).toHaveLength(2);
        });

        it('should return empty array for date with no events', () => {
            const eventsMap = new Map<string, CalendarEvent[]>();
            eventsMap.set('2026-01-15', [createEvent('ev-1')]);
            const row = createRow(eventsMap);

            const result = getEventsForDate(row, new Date(2026, 0, 16));

            expect(result).toHaveLength(0);
        });

        it('should return empty array for row with no events', () => {
            const row = createRow(new Map());

            const result = getEventsForDate(row, new Date(2026, 0, 15));

            expect(result).toHaveLength(0);
        });
    });
});
