import { CalendarSlice, CalendarActions, CalendarState, DateKeyRange, mergeRangeFetchedMap, recordEquals } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { logger } from '@/lib/logger';

// "{foremanId}-{dateKey}" 複合キーから dateKey 部分を取り出す
// (foremanId は UUID でハイフンを含むため、末尾10文字 = YYYY-MM-DD を採用)
const dateKeyOfCellKey = (key: string) => key.slice(-10);

interface CellRemarkSlice extends
    Pick<CalendarState, 'cellRemarks' | 'cellRemarksLoading' | 'cellRemarksInitialized'>,
    Pick<CalendarActions, 'fetchCellRemarks' | 'getCellRemark' | 'setCellRemark'> { }

export const createCellRemarkSlice: CalendarSlice<CellRemarkSlice> = (set, get) => ({
    cellRemarks: {},
    cellRemarksLoading: false,
    cellRemarksInitialized: false,

    fetchCellRemarks: async (range?: DateKeyRange) => {
        set({ cellRemarksLoading: true });
        try {
            const url = range
                ? `/api/calendar/cell-remarks?from=${range.from}&to=${range.to}`
                : '/api/calendar/cell-remarks';
            // タイムアウト付き: ストールすると初回ロードのスピナーが永久に解除できないため
            const response = await fetchWithTimeout(url, { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                if (range) {
                    // 範囲内キーのみ差し替え（範囲外のキャッシュは保持）
                    set((state) => ({
                        cellRemarks: mergeRangeFetchedMap(state.cellRemarks, data, range, dateKeyOfCellKey),
                        cellRemarksInitialized: true,
                    }));
                } else {
                    // 内容不変なら既存参照を維持（購読側の再レンダー防止）
                    set((state) => ({
                        cellRemarks: recordEquals(state.cellRemarks, data) ? state.cellRemarks : data,
                        cellRemarksInitialized: true,
                    }));
                }
            } else {
                // 失敗時もinitializedを立ててUIをアンブロック（空メモとして扱う）
                set({ cellRemarksInitialized: true });
            }
        } catch (error) {
            logger.error('Failed to fetch cell remarks:', error);
            set({ cellRemarksInitialized: true });
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
            logger.error('Failed to set cell remark:', error);
            // Revert or fetch on error? Ideally revert, but fetching is safer to sync state
            get().fetchCellRemarks();
        }
    },
});
