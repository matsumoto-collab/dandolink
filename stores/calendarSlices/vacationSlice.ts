import { CalendarSlice, CalendarActions, CalendarState } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type VacationSlice = Pick<CalendarState, 'vacations' | 'vacationsLoading' | 'vacationsInitialized'> &
    Pick<CalendarActions, 'fetchVacations' | 'getVacationEmployees' | 'setVacationEmployees' | 'addVacationEmployee' | 'removeVacationEmployee' | 'getVacationRemarks' | 'setVacationRemarks'>;

export const createVacationSlice: CalendarSlice<VacationSlice> = (set, get) => ({
    vacations: {},
    vacationsLoading: false,
    vacationsInitialized: false,

    fetchVacations: async () => {
        set({ vacationsLoading: true });
        try {
            const response = await fetch('/api/calendar/vacations', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({ vacations: data, vacationsInitialized: true });
            }
        } catch (error) {
            console.error('Failed to fetch vacations:', error);
        } finally {
            set({ vacationsLoading: false });
        }
    },

    getVacationEmployees: (dateKey: string) => {
        return get().vacations[dateKey]?.employeeIds || [];
    },

    setVacationEmployees: async (dateKey: string, employeeIds: string[]) => {
        const previousVacation = get().vacations[dateKey];
        const currentRemarks = previousVacation?.remarks || '';
        set((state) => ({
            vacations: {
                ...state.vacations,
                [dateKey]: { employeeIds, remarks: currentRemarks },
            },
        }));
        try {
            const res = await fetch('/api/calendar/vacations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, employeeIds, remarks: currentRemarks }),
            });
            if (!res.ok) throw new Error('Failed to save vacation');
            sendBroadcast('vacation_updated', { dateKey });
        } catch (error) {
            console.error('Failed to save vacation:', error);
            set((state) => ({
                vacations: {
                    ...state.vacations,
                    [dateKey]: previousVacation || { employeeIds: [], remarks: '' },
                },
            }));
        }
    },

    addVacationEmployee: async (dateKey: string, employeeId: string) => {
        const current = get().getVacationEmployees(dateKey);
        if (!current.includes(employeeId)) {
            await get().setVacationEmployees(dateKey, [...current, employeeId]);
        }
    },

    removeVacationEmployee: async (dateKey: string, employeeId: string) => {
        const current = get().getVacationEmployees(dateKey);
        await get().setVacationEmployees(dateKey, current.filter((id) => id !== employeeId));
    },

    getVacationRemarks: (dateKey: string) => {
        return get().vacations[dateKey]?.remarks || '';
    },

    setVacationRemarks: async (dateKey: string, remarks: string) => {
        const previousVacation = get().vacations[dateKey];
        const currentEmployees = previousVacation?.employeeIds || [];
        set((state) => ({
            vacations: {
                ...state.vacations,
                [dateKey]: { employeeIds: currentEmployees, remarks },
            },
        }));
        try {
            const res = await fetch('/api/calendar/vacations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, employeeIds: currentEmployees, remarks }),
            });
            if (!res.ok) throw new Error('Failed to save vacation remarks');
            sendBroadcast('vacation_updated', { dateKey });
        } catch (error) {
            console.error('Failed to save vacation remarks:', error);
            set((state) => ({
                vacations: {
                    ...state.vacations,
                    [dateKey]: previousVacation || { employeeIds: [], remarks: '' },
                },
            }));
        }
    },
});
