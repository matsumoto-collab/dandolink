import { CalendarSlice, CalendarActions, CalendarState } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

interface CellRemarkSlice extends
    Pick<CalendarState, 'cellRemarks' | 'cellRemarksLoading' | 'cellRemarksInitialized'>,
    Pick<CalendarActions, 'fetchCellRemarks' | 'getCellRemark' | 'setCellRemark'> { }

export const createCellRemarkSlice: CalendarSlice<CellRemarkSlice> = (set, get) => ({
    cellRemarks: {},
    cellRemarksLoading: false,
    cellRemarksInitialized: false,

    fetchCellRemarks: async () => {
        set({ cellRemarksLoading: true });
        try {
            const response = await fetch('/api/calendar/cell-remarks');
            if (response.ok) {
                const data = await response.json();
                set({ cellRemarks: data, cellRemarksInitialized: true });
            }
        } catch (error) {
            console.error('Failed to fetch cell remarks:', error);
        } finally {
            set({ cellRemarksLoading: false });
        }
    },

    getCellRemark: (foremanId: string, dateKey: string) => {
        const key = `${foremanId}-${dateKey}`;
        return get().cellRemarks[key] || '';
    },

    setCellRemark: async (foremanId: string, dateKey: string, text: string) => {
        const key = `${foremanId}-${dateKey}`;

        // Optimistic update
        set((state) => ({
            cellRemarks: {
                ...state.cellRemarks,
                [key]: text,
            },
        }));

        try {
            await fetch('/api/calendar/cell-remarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ foremanId, dateKey, text }),
            });
            sendBroadcast('cell_remark_updated', { foremanId, dateKey });
        } catch (error) {
            console.error('Failed to set cell remark:', error);
            // Revert or fetch on error? Ideally revert, but fetching is safer to sync state
            get().fetchCellRemarks();
        }
    },
});
