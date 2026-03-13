import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

// Mock parseDailyReportDates
jest.mock('@/stores/calendarSlices/types', () => {
    const originalModule = jest.requireActual('@/stores/calendarSlices/types');
    return {
        __esModule: true,
        ...originalModule,
        parseDailyReportDates: jest.fn((r: any) => ({
            ...r,
            date: new Date(r.date),
        })),
    };
});

global.fetch = jest.fn();

describe('dailyReportSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      dailyReports: [],
      dailyReportsLoading: false,
      dailyReportsInitialized: false,
    });
  });

  describe('fetchDailyReports', () => {
    it('初期ロード時(パラメータなし)、全体を置き換える', async () => {
      const mockReports = [{ id: '1', date: '2026-03-12T00:00:00.000Z' }];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReports),
      });

      const { fetchDailyReports } = useCalendarStore.getState();
      await fetchDailyReports({});

      const state = useCalendarStore.getState();
      expect(global.fetch).toHaveBeenCalledWith('/api/daily-reports?', { cache: 'no-store' });
      expect(state.dailyReports).toHaveLength(1);
      expect(state.dailyReports[0].id).toBe('1');
      expect(state.dailyReportsInitialized).toBe(true);
      expect(state.dailyReportsLoading).toBe(false);
    });

    it('絞り込み取得時、既存のレポートをマージする(追加)', async () => {
      useCalendarStore.setState({
        dailyReports: [{ id: 'old', date: new Date('2026-03-11') } as any],
        dailyReportsInitialized: true,
      });

      const mockReports = [{ id: 'new', date: '2026-03-12T00:00:00.000Z' }];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReports),
      });

      const { fetchDailyReports } = useCalendarStore.getState();
      await fetchDailyReports({ foremanId: 'f1' });

      const state = useCalendarStore.getState();
      expect(state.dailyReports).toHaveLength(2); // old + new
      expect(state.dailyReports[1].id).toBe('new');
    });

    it('絞り込み取得時、既存のレポートをマージする(更新)', async () => {
      useCalendarStore.setState({
        dailyReports: [{ id: '1', date: new Date('2026-03-11'), content: 'old' } as any],
        dailyReportsInitialized: true,
      });

      const mockReports = [{ id: '1', date: '2026-03-11T00:00:00.000Z', content: 'new' }];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReports),
      });

      const { fetchDailyReports } = useCalendarStore.getState();
      await fetchDailyReports({ date: '2026-03-11' });

      const state = useCalendarStore.getState();
      expect(state.dailyReports).toHaveLength(1);
      expect((state.dailyReports[0] as any).content).toBe('new');
    });

    it('fetchで例外が発生したときにエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchDailyReports } = useCalendarStore.getState();
      await fetchDailyReports();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch daily reports:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('getDailyReportByForemanAndDate', () => {
    it('指定した職長と日付の日報を取得できる', () => {
      useCalendarStore.setState({
        dailyReports: [
          { foremanId: 'f1', date: new Date('2026-03-12T00:00:00.000Z') } as any,
          { foremanId: 'f2', date: '2026-03-13' } as any, // fallback test for string dates
        ],
      });

      const { getDailyReportByForemanAndDate } = useCalendarStore.getState();
      const report1 = getDailyReportByForemanAndDate('f1', '2026-03-12');
      expect(report1).toBeDefined();

      const report2 = getDailyReportByForemanAndDate('f2', '2026-03-13');
      expect(report2).toBeDefined();

      const notFound = getDailyReportByForemanAndDate('f1', '2026-03-14');
      expect(notFound).toBeUndefined();
    });
  });

  describe('saveDailyReport', () => {
    it('正常に新規作成し、ブロードキャストを送信する', async () => {
      const input = { foremanId: 'f1', date: '2026-03-12', weather: '晴れ' };
      const savedData = { ...input, id: 'new_id' };
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(savedData),
      });

      const { saveDailyReport } = useCalendarStore.getState();
      const result = await saveDailyReport(input as any);

      expect(result.id).toBe('new_id');
      const state = useCalendarStore.getState();
      expect(state.dailyReports).toHaveLength(1);
      expect(state.dailyReports[0].id).toBe('new_id');
      
      expect(global.fetch).toHaveBeenCalledWith('/api/daily-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(sendBroadcast).toHaveBeenCalledWith('daily_report_updated', { id: 'new_id', foremanId: 'f1' });
    });

    it('既存のレポートを更新する', async () => {
      useCalendarStore.setState({
        dailyReports: [{ id: '1', foremanId: 'f1' } as any],
      });

      const input = { id: '1', foremanId: 'f1', weather: '雨' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(input),
      });

      const { saveDailyReport } = useCalendarStore.getState();
      await saveDailyReport(input as any);

      const state = useCalendarStore.getState();
      expect(state.dailyReports).toHaveLength(1);
      expect((state.dailyReports[0] as any).weather).toBe('雨');
    });

    it('保存失敗時にエラーをスローする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Save failed' }),
      });

      const { saveDailyReport } = useCalendarStore.getState();
      await expect(saveDailyReport({} as any)).rejects.toThrow('Save failed');
    });
  });

  describe('deleteDailyReport', () => {
    it('正常に削除し、ブロードキャストを送信する', async () => {
      useCalendarStore.setState({
        dailyReports: [{ id: '1' } as any, { id: '2' } as any],
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const { deleteDailyReport } = useCalendarStore.getState();
      await deleteDailyReport('1');

      const state = useCalendarStore.getState();
      expect(state.dailyReports).toHaveLength(1);
      expect(state.dailyReports[0].id).toBe('2');
      expect(global.fetch).toHaveBeenCalledWith('/api/daily-reports/1', { method: 'DELETE' });
      expect(sendBroadcast).toHaveBeenCalledWith('daily_report_deleted', { id: '1' });
    });

    it('削除失敗時にエラーをスローする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const { deleteDailyReport } = useCalendarStore.getState();
      await expect(deleteDailyReport('1')).rejects.toThrow('Failed to delete daily report');
    });
  });
});
