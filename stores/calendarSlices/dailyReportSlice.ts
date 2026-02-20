import { CalendarSlice, CalendarActions, CalendarState, parseDailyReportDates } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type DailyReportSlice = Pick<CalendarState, 'dailyReports' | 'dailyReportsLoading' | 'dailyReportsInitialized'> &
    Pick<CalendarActions, 'fetchDailyReports' | 'getDailyReportByForemanAndDate' | 'saveDailyReport' | 'deleteDailyReport'>;

export const createDailyReportSlice: CalendarSlice<DailyReportSlice> = (set, get) => ({
    dailyReports: [],
    dailyReportsLoading: false,
    dailyReportsInitialized: false,

    fetchDailyReports: async (params) => {
        const isNarrowFetch = !!(params?.foremanId || params?.date);
        // narrow fetch（モーダル等での個別取得）は既に初期データがあればローディング表示しない
        if (!isNarrowFetch || !get().dailyReportsInitialized) {
            set({ dailyReportsLoading: true });
        }
        try {
            const searchParams = new URLSearchParams();
            if (params?.foremanId) searchParams.set('foremanId', params.foremanId);
            if (params?.date) searchParams.set('date', params.date);
            if (params?.startDate) searchParams.set('startDate', params.startDate);
            if (params?.endDate) searchParams.set('endDate', params.endDate);

            const response = await fetch(`/api/daily-reports?${searchParams.toString()}`);
            if (response.ok) {
                const data = await response.json();
                const parsed = data.map(parseDailyReportDates);

                if (isNarrowFetch && get().dailyReportsInitialized) {
                    // Merge: update existing or add new, don't replace all
                    set((state) => {
                        const merged = [...state.dailyReports];
                        for (const report of parsed) {
                            const idx = merged.findIndex((r) => r.id === report.id);
                            if (idx >= 0) {
                                merged[idx] = report;
                            } else {
                                merged.push(report);
                            }
                        }
                        return { dailyReports: merged };
                    });
                } else {
                    // Full replace for initial/broad fetches
                    set({
                        dailyReports: parsed,
                        dailyReportsInitialized: true,
                    });
                }
            }
        } catch (error) {
            console.error('Failed to fetch daily reports:', error);
        } finally {
            set({ dailyReportsLoading: false });
        }
    },

    getDailyReportByForemanAndDate: (foremanId, date) => {
        return get().dailyReports.find((report) => {
            const reportDate = report.date instanceof Date ? report.date.toISOString().split('T')[0] : report.date;
            return report.foremanId === foremanId && reportDate === date;
        });
    },

    saveDailyReport: async (input) => {
        const response = await fetch('/api/daily-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save daily report');
        }

        const saved = await response.json();
        const parsed = parseDailyReportDates(saved);

        set((state) => {
            const existingIndex = state.dailyReports.findIndex((r) => r.id === parsed.id);
            if (existingIndex >= 0) {
                const updated = [...state.dailyReports];
                updated[existingIndex] = parsed;
                return { dailyReports: updated };
            }
            return { dailyReports: [...state.dailyReports, parsed] };
        });

        sendBroadcast('daily_report_updated', { id: parsed.id, foremanId: parsed.foremanId });
        return parsed;
    },

    deleteDailyReport: async (id) => {
        const response = await fetch(`/api/daily-reports/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            throw new Error('Failed to delete daily report');
        }

        set((state) => ({
            dailyReports: state.dailyReports.filter((r) => r.id !== id),
        }));
        sendBroadcast('daily_report_deleted', { id });
    },
});
