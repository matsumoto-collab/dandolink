import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast as _sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

const mockForemen = [
  { id: 'f1', displayName: '田中', email: 't@test.com', role: 'foreman' },
  { id: 'f2', displayName: '鈴木', email: 's@test.com', role: 'foreman' },
  { id: 'f3', displayName: '佐藤', email: 'sa@test.com', role: 'foreman' },
];

describe('foremanSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      displayedForemanIds: [],
      allForemen: [],
      foremanSettingsLoading: false,
      foremanSettingsInitialized: false,
    });
  });

  describe('fetchForemen', () => {
    it('正常に職長一覧を取得できる', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockForemen),
      });

      await useCalendarStore.getState().fetchForemen();

      expect(useCalendarStore.getState().allForemen).toEqual(mockForemen);
    });

    it('fetch失敗時にエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().fetchForemen();

      expect(spy).toHaveBeenCalledWith('Failed to fetch foremen:', expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('fetchForemanSettings', () => {
    it('fetch失敗時にエラーログを出力しローディングをリセットする', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().fetchForemanSettings();

      const state = useCalendarStore.getState();
      expect(state.foremanSettingsLoading).toBe(false);
      expect(state.foremanSettingsInitialized).toBe(true);
      expect(spy).toHaveBeenCalledWith('Failed to fetch user settings:', expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('addForeman', () => {
    it('API失敗時にロールバックする', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1'] });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().addForeman('f2');

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1']);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('removeForeman', () => {
    it('API失敗時にロールバックする', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2'] });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().removeForeman('f2');

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1', 'f2']);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('moveForeman', () => {
    it('API失敗時にロールバックする', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2', 'f3'] });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().moveForeman('f2', 'up');

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1', 'f2', 'f3']);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('initializeForemenFromAll', () => {
    it('displayedForemanIdsが空の場合、allForemenから初期化する', () => {
      useCalendarStore.setState({ allForemen: mockForemen, displayedForemanIds: [] });

      useCalendarStore.getState().initializeForemenFromAll();

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1', 'f2', 'f3']);
    });

    it('displayedForemanIdsが既にある場合は上書きしない', () => {
      useCalendarStore.setState({ allForemen: mockForemen, displayedForemanIds: ['f1'] });

      useCalendarStore.getState().initializeForemenFromAll();

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1']);
    });
  });
});
