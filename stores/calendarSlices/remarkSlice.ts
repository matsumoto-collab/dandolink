import { CalendarSlice, CalendarActions, CalendarState, recordEquals } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { logger } from '@/lib/logger';

type RemarkSlice = Pick<CalendarState, 'remarks' | 'remarksLoading' | 'remarksInitialized'> &
    Pick<CalendarActions, 'fetchRemarks' | 'getRemark' | 'setRemark'>;

export const createRemarkSlice: CalendarSlice<RemarkSlice> = (set, get) => ({
    remarks: {},
    remarksLoading: false,
    remarksInitialized: false,

    fetchRemarks: async () => {
        set({ remarksLoading: true });
        try {
            const response = await fetch('/api/calendar/remarks', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                // 内容不変なら既存参照を維持（購読側の再レンダー防止）
                set((state) => ({
                    remarks: recordEquals(state.remarks, data) ? state.remarks : data,
                    remarksInitialized: true,
                }));
            }
        } catch (error) {
            logger.error('Failed to fetch remarks:', error);
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
            sendBroadcast('remark_updated', { dateKey });
        } catch (error) {
            logger.error('Failed to set remark:', error);
            get().fetchRemarks();
        }
    },
});
