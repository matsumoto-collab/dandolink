import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

describe('cellRemarkSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      cellRemarks: {},
      cellRemarksLoading: false,
      cellRemarksInitialized: false,
    });
  });

  describe('fetchCellRemarks', () => {
    it('正常にセル備考を取得できる', async () => {
      const mockRemarks = { 'foreman1-2026-03-12': 'テスト' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRemarks),
      });

      const { fetchCellRemarks } = useCalendarStore.getState();
      await fetchCellRemarks();

      const state = useCalendarStore.getState();
      expect(state.cellRemarks).toEqual(mockRemarks);
      expect(state.cellRemarksInitialized).toBe(true);
      expect(state.cellRemarksLoading).toBe(false);
    });

    it('fetchのresponse.okがfalseの場合、状態は更新されない', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

      const { fetchCellRemarks } = useCalendarStore.getState();
      await fetchCellRemarks();

      const state = useCalendarStore.getState();
      expect(state.cellRemarksInitialized).toBe(false);
    });

    it('fetchで例外が発生したときにエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchCellRemarks } = useCalendarStore.getState();
      await fetchCellRemarks();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getCellRemark', () => {
    it('指定したキーの備考を取得できる', () => {
      useCalendarStore.setState({
        cellRemarks: { 'foreman1-2026-03-12': 'テスト備考' },
      });
      const { getCellRemark } = useCalendarStore.getState();
      expect(getCellRemark('foreman1', '2026-03-12')).toBe('テスト備考');
    });

    it('存在しないキーの場合は空文字を返す', () => {
      useCalendarStore.setState({ cellRemarks: {} });
      const { getCellRemark } = useCalendarStore.getState();
      expect(getCellRemark('foreman1', '2026-03-12')).toBe('');
    });
  });

  describe('setCellRemark', () => {
    it('正常にセル備考を更新し、ブロードキャストを送信する', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const { setCellRemark } = useCalendarStore.getState();
      await setCellRemark('foreman1', '2026-03-12', '更新テスト');

      const state = useCalendarStore.getState();
      expect(state.cellRemarks['foreman1-2026-03-12']).toBe('更新テスト');
      expect(global.fetch).toHaveBeenCalledWith('/api/calendar/cell-remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foremanId: 'foreman1', dateKey: '2026-03-12', text: '更新テスト' }),
      });
      expect(sendBroadcast).toHaveBeenCalledWith('cell_remark_updated', { foremanId: 'foreman1', dateKey: '2026-03-12' });
    });

    it('更新失敗時にエラーログを出力し、fetchCellRemarksを呼び出す', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      // error handler will call fetchCellRemarks, so we mock its resolve
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const { setCellRemark } = useCalendarStore.getState();
      await setCellRemark('foreman1', '2026-03-12', '更新テスト');

      expect(consoleSpy).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(2); // set(POST) and fetchCellRemarks(GET)
      
      consoleSpy.mockRestore();
    });
  });
});
