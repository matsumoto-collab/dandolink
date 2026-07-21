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
      floatingLaneIndex: null,
      allForemen: [],
      foremanSettingsLoading: false,
      foremanSettingsInitialized: false,
    });
  });

  /** PATCH に渡した displayedForemanIds を取り出す */
  const patchedIds = (): string[] => {
    const call = (global.fetch as jest.Mock).mock.calls.at(-1);
    return JSON.parse(call[1].body).displayedForemanIds;
  };

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

  // 浮きレーンの位置は同じ設定配列に予約ID 'unassigned' として混ぜて保存する。
  // ストアの displayedForemanIds には絶対に混ぜない（他画面が班として扱ってしまうため）
  describe('moveFloatingLane', () => {
    it('上へ移動すると位置が1段上がり、保存配列にだけ予約IDが入る', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2', 'f3'], allForemen: mockForemen, floatingLaneIndex: null });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      await useCalendarStore.getState().moveFloatingLane('up');

      expect(useCalendarStore.getState().floatingLaneIndex).toBe(2);
      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1', 'f2', 'f3']);
      expect(patchedIds()).toEqual(['f1', 'f2', 'unassigned', 'f3']);
    });

    it('一番上では動かず保存もしない', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2'], allForemen: mockForemen, floatingLaneIndex: 0 });

      await useCalendarStore.getState().moveFloatingLane('up');

      expect(useCalendarStore.getState().floatingLaneIndex).toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('API失敗時にロールバックする', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2'], allForemen: mockForemen, floatingLaneIndex: 2 });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().moveFloatingLane('up');

      expect(useCalendarStore.getState().floatingLaneIndex).toBe(2);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('fetchForemanSettings（浮きレーン位置の切り離し）', () => {
    it('保存配列の予約IDを位置として取り出し、職長IDには残さない', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ displayedForemanIds: ['f1', 'unassigned', 'f2'] }),
      });

      await useCalendarStore.getState().fetchForemanSettings();

      expect(useCalendarStore.getState().displayedForemanIds).toEqual(['f1', 'f2']);
      expect(useCalendarStore.getState().floatingLaneIndex).toBe(1);
    });
  });

  describe('removeForeman（浮きレーン位置の追従）', () => {
    it('職長が減っても位置が溢れないように詰める', async () => {
      useCalendarStore.setState({ displayedForemanIds: ['f1', 'f2'], floatingLaneIndex: 2 });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      await useCalendarStore.getState().removeForeman('f2');

      expect(useCalendarStore.getState().floatingLaneIndex).toBe(1);
      expect(patchedIds()).toEqual(['f1', 'unassigned']);
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
