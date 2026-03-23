import { CalendarSlice, CalendarActions, CalendarState } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type VacationSlice = Pick<CalendarState, 'vacations' | 'vacationsLoading' | 'vacationsInitialized'> &
    Pick<CalendarActions, 'fetchVacations' | 'getVacationEmployees' | 'setVacationEmployees' | 'addVacationEmployee' | 'removeVacationEmployee' | 'getVacationRemarks' | 'setVacationRemarks'>;

// 自身の保存操作中にRealtime/Broadcastによる再fetchを抑止するフラグ
let savingVacation = false;

export const createVacationSlice: CalendarSlice<VacationSlice> = (set, get) => ({
    vacations: {},
    vacationsLoading: false,
    vacationsInitialized: false,

    fetchVacations: async () => {
        // 自身の保存操作中は再fetchをスキップ（楽観的更新を上書きしない）
        if (savingVacation) return;
        set({ vacationsLoading: true });
        try {
            const response = await fetch('/api/calendar/vacations', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                // 保存中にfetchが走った場合は無視
                if (!savingVacation) {
                    set({ vacations: data, vacationsInitialized: true });
                }
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
        savingVacation = true;
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
        } finally {
            // Realtime通知が落ち着くまで少し待ってからフラグを解除
            setTimeout(() => { savingVacation = false; }, 1000);
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
        savingVacation = true;
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
        } finally {
            setTimeout(() => { savingVacation = false; }, 1000);
        }
    },
});
