import { CalendarSlice, CalendarActions, CalendarState } from './types';

type RemarkSlice = Pick<CalendarState, 'remarks' | 'remarksLoading' | 'remarksInitialized'> &
    Pick<CalendarActions, 'fetchRemarks' | 'getRemark' | 'setRemark'>;

export const createRemarkSlice: CalendarSlice<RemarkSlice> = (set, get) => ({
    remarks: {},
    remarksLoading: false,
    remarksInitialized: false,

    fetchRemarks: async () => {
        set({ remarksLoading: true });
        try {
            const response = await fetch('/api/calendar/remarks');
            if (response.ok) {
                const data = await response.json();
                set({ remarks: data, remarksInitialized: true });
            }
        } catch (error) {
            console.error('Failed to fetch remarks:', error);
        } finally {
            set({ remarksLoading: false });
        }
    },

    getRemark: (dateKey: string) => {
        return get().remarks[dateKey] || '';
    },

    setRemark: async (dateKey: string, text: string) => {
        // Optimistic update
        set((state) => ({
            remarks: {
                ...state.remarks,
                [dateKey]: text,
            },
        }));
        try {
            await fetch('/api/calendar/remarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, text }),
            });
        } catch (error) {
            console.error('Failed to set remark:', error);
            get().fetchRemarks();
        }
    },
});
