import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

describe('remarkSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      remarks: {},
      remarksLoading: false,
      remarksInitialized: false,
    });
  });

  describe('fetchRemarks', () => {
    it('正常に備考を取得できる', async () => {
      const mockRemarks = { '2026-03-12': 'テスト' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRemarks),
      });

      const { fetchRemarks } = useCalendarStore.getState();
      await fetchRemarks();

      const state = useCalendarStore.getState();
      expect(state.remarks).toEqual(mockRemarks);
      expect(state.remarksInitialized).toBe(true);
      expect(state.remarksLoading).toBe(false);
    });

    it('fetchのresponse.okがfalseの場合、状態は更新されない', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

      const { fetchRemarks } = useCalendarStore.getState();
      await fetchRemarks();

      const state = useCalendarStore.getState();
      expect(state.remarksInitialized).toBe(false);
    });

    it('fetchで例外が発生したときにエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchRemarks } = useCalendarStore.getState();
      await fetchRemarks();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getRemark', () => {
    it('指定したキーの備考を取得できる', () => {
      useCalendarStore.setState({
        remarks: { '2026-03-12': 'テスト備考' },
      });
      const { getRemark } = useCalendarStore.getState();
      expect(getRemark('2026-03-12')).toBe('テスト備考');
    });

    it('存在しないキーの場合は空文字を返す', () => {
      useCalendarStore.setState({ remarks: {} });
      const { getRemark } = useCalendarStore.getState();
      expect(getRemark('2026-03-12')).toBe('');
    });
  });

  describe('setRemark', () => {
    it('正常に備考を更新し、ブロードキャストを送信する', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const { setRemark } = useCalendarStore.getState();
      await setRemark('2026-03-12', '更新テスト');

      const state = useCalendarStore.getState();
      expect(state.remarks['2026-03-12']).toBe('更新テスト');
      expect(global.fetch).toHaveBeenCalledWith('/api/calendar/remarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: '2026-03-12', text: '更新テスト' }),
      });
      expect(sendBroadcast).toHaveBeenCalledWith('remark_updated', { dateKey: '2026-03-12' });
    });

    it('更新失敗時にエラーログを出力し、fetchRemarksを呼び出す', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const { setRemark } = useCalendarStore.getState();
      await setRemark('2026-03-12', '更新テスト');

      expect(consoleSpy).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(2); // set(POST) and fetchRemarks(GET)
      
      consoleSpy.mockRestore();
    });
  });
});
