import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast } from '@/lib/broadcastChannel';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

describe('vacationSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      vacations: {},
      vacationsLoading: false,
      vacationsInitialized: false,
    });
  });

  describe('fetchVacations', () => {
    it('正常に休暇情報を取得できる', async () => {
      const mockVacations = { '2026-03-12': { employeeIds: ['emp1'], remarks: 'テスト' } };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockVacations),
      });

      const { fetchVacations } = useCalendarStore.getState();
      await fetchVacations();

      const state = useCalendarStore.getState();
      expect(state.vacations).toEqual(mockVacations);
      expect(state.vacationsInitialized).toBe(true);
      expect(state.vacationsLoading).toBe(false);
    });

    it('fetchのresponse.okがfalseの場合、状態は更新されない', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

      const { fetchVacations } = useCalendarStore.getState();
      await fetchVacations();

      const state = useCalendarStore.getState();
      expect(state.vacationsInitialized).toBe(false);
    });

    it('fetchで例外が発生したときにエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchVacations } = useCalendarStore.getState();
      await fetchVacations();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getVacationEmployees', () => {
    it('指定したキーの休暇対象者を取得できる', () => {
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['emp1', 'emp2'], remarks: '' } },
      });
      const { getVacationEmployees } = useCalendarStore.getState();
      expect(getVacationEmployees('2026-03-12')).toEqual(['emp1', 'emp2']);
    });

    it('存在しないキーの場合は空配列を返す', () => {
      useCalendarStore.setState({ vacations: {} });
      const { getVacationEmployees } = useCalendarStore.getState();
      expect(getVacationEmployees('2026-03-12')).toEqual([]);
    });
  });

  describe('setVacationEmployees', () => {
    it('正常に休暇対象者を更新し、ブロードキャストを送信する', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const { setVacationEmployees } = useCalendarStore.getState();
      await setVacationEmployees('2026-03-12', ['emp1', 'emp2']);

      const state = useCalendarStore.getState();
      expect(state.vacations['2026-03-12']).toEqual({ employeeIds: ['emp1', 'emp2'], remarks: '' });
      expect(global.fetch).toHaveBeenCalledWith('/api/calendar/vacations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: '2026-03-12', employeeIds: ['emp1', 'emp2'], remarks: '' }),
      });
      expect(sendBroadcast).toHaveBeenCalledWith('vacation_updated', { dateKey: '2026-03-12' });
    });

    it('更新失敗時にエラーログを出力し、以前の状態にロールバックする', async () => {
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['old_emp'], remarks: 'old_remark' } },
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { setVacationEmployees } = useCalendarStore.getState();
      await setVacationEmployees('2026-03-12', ['emp1']);

      const state = useCalendarStore.getState();
      // Rollback to old_emp
      expect(state.vacations['2026-03-12']).toEqual({ employeeIds: ['old_emp'], remarks: 'old_remark' });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to save vacation:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('addVacationEmployee / removeVacationEmployee', () => {
    it('addVacationEmployee: 未登録なら追加しsetVacationEmployeesを呼ぶ', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['emp1'], remarks: '' } },
      });

      const { addVacationEmployee } = useCalendarStore.getState();
      await addVacationEmployee('2026-03-12', 'emp2');

      const state = useCalendarStore.getState();
      expect(state.vacations['2026-03-12'].employeeIds).toEqual(['emp1', 'emp2']);
    });

    it('addVacationEmployee: 登録済なら何もしない', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['emp1'], remarks: '' } },
      });

      const { addVacationEmployee } = useCalendarStore.getState();
      await addVacationEmployee('2026-03-12', 'emp1');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('removeVacationEmployee: 指定した要素を削除しsetVacationEmployeesを呼ぶ', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['emp1', 'emp2'], remarks: '' } },
      });

      const { removeVacationEmployee } = useCalendarStore.getState();
      await removeVacationEmployee('2026-03-12', 'emp1');

      const state = useCalendarStore.getState();
      expect(state.vacations['2026-03-12'].employeeIds).toEqual(['emp2']);
    });
  });

  describe('getVacationRemarks / setVacationRemarks', () => {
    it('getVacationRemarks: 指定したキーの休暇備考を取得できる', () => {
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: [], remarks: '備考テスト' } },
      });
      const { getVacationRemarks } = useCalendarStore.getState();
      expect(getVacationRemarks('2026-03-12')).toBe('備考テスト');
    });

    it('getVacationRemarks: 存在しないキーの場合は空文字を返す', () => {
      useCalendarStore.setState({ vacations: {} });
      const { getVacationRemarks } = useCalendarStore.getState();
      expect(getVacationRemarks('2026-03-12')).toBe('');
    });

    it('setVacationRemarks: 正常に休暇備考を更新し、ブロードキャストを送信する', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

      const { setVacationRemarks } = useCalendarStore.getState();
      await setVacationRemarks('2026-03-12', '更新備考');

      const state = useCalendarStore.getState();
      expect(state.vacations['2026-03-12']).toEqual({ employeeIds: [], remarks: '更新備考' });
      expect(global.fetch).toHaveBeenCalledWith('/api/calendar/vacations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateKey: '2026-03-12', employeeIds: [], remarks: '更新備考' }),
      });
      expect(sendBroadcast).toHaveBeenCalledWith('vacation_updated', { dateKey: '2026-03-12' });
    });

    it('setVacationRemarks: 更新失敗時にエラーログを出力し、以前の状態にロールバックする', async () => {
      useCalendarStore.setState({
        vacations: { '2026-03-12': { employeeIds: ['emp1'], remarks: 'old_remark' } },
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { setVacationRemarks } = useCalendarStore.getState();
      await setVacationRemarks('2026-03-12', 'new_remark');

      const state = useCalendarStore.getState();
      // Rollback to old_remark
      expect(state.vacations['2026-03-12']).toEqual({ employeeIds: ['emp1'], remarks: 'old_remark' });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to save vacation remarks:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });
});
