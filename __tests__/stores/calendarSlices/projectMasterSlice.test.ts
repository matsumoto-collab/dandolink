import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast as _sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

const mockPm = {
  id: 'pm1',
  title: 'テスト案件',
  name: 'テスト',
  status: 'active',
  createdAt: '2026-03-10T00:00:00.000Z',
  updatedAt: '2026-03-10T00:00:00.000Z',
};

describe('projectMasterSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      projectMasters: [],
      projectMastersLoading: false,
      projectMastersError: null,
      projectMastersInitialized: false,
    });
  });

  describe('fetchProjectMasters', () => {
    it('fetch失敗(ok:false)時にエラーをセットする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await useCalendarStore.getState().fetchProjectMasters();

      const state = useCalendarStore.getState();
      expect(state.projectMastersError).toBe('案件マスターの取得に失敗しました');
      expect(state.projectMastersLoading).toBe(false);
      spy.mockRestore();
    });
  });

  describe('createProjectMaster', () => {
    it('API失敗時にエラーをスローする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: '作成エラー' }),
      });

      await expect(
        useCalendarStore.getState().createProjectMaster({ title: 'test' } as never)
      ).rejects.toThrow('作成エラー');
    });
  });

  describe('updateProjectMaster', () => {
    it('API失敗時にエラーをスローする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: '更新エラー' }),
      });

      await expect(
        useCalendarStore.getState().updateProjectMaster('pm1', { title: 'updated' } as never)
      ).rejects.toThrow('更新エラー');
    });
  });

  describe('deleteProjectMaster', () => {
    it('API失敗時にエラーをスローする', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: '削除エラー' }),
      });

      await expect(
        useCalendarStore.getState().deleteProjectMaster('pm1')
      ).rejects.toThrow('削除エラー');
    });
  });

  describe('getProjectMasterById', () => {
    it('IDで案件マスターを取得できる', () => {
      useCalendarStore.setState({ projectMasters: [mockPm] as never[] });

      const result = useCalendarStore.getState().getProjectMasterById('pm1');
      expect(result).toEqual(mockPm);
    });

    it('存在しないIDの場合undefinedを返す', () => {
      useCalendarStore.setState({ projectMasters: [mockPm] as never[] });

      const result = useCalendarStore.getState().getProjectMasterById('nonexistent');
      expect(result).toBeUndefined();
    });
  });
});
