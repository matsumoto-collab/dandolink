import { useCalendarStore } from '@/stores/calendarStore';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { ConflictUpdateError } from '@/stores/calendarSlices/types';

jest.mock('@/lib/broadcastChannel', () => ({
  sendBroadcast: jest.fn(),
}));

global.fetch = jest.fn();

describe('assignmentSlice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useCalendarStore.setState({
      assignments: [],
      projectMasters: [],
      projectsLoading: false,
      projectsInitialized: false,
    });
  });

  describe('fetchAssignments', () => {
    it('正常に手配データを取得できる', async () => {
      const mockAssignments = [
        {
          id: '1',
          projectMasterId: 'pm1',
          date: '2026-03-12T00:00:00.000Z',
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAssignments),
      });

      const { fetchAssignments } = useCalendarStore.getState();
      await fetchAssignments('2026-03-10', '2026-03-16');

      const state = useCalendarStore.getState();
      expect(state.assignments[0].id).toBe('1');
      expect(state.assignments[0].date).toBeInstanceOf(Date);
      expect(state.projectsInitialized).toBe(true);
      expect(state.projectsLoading).toBe(false);
    });

    it('取得失敗時にエラーログが出力され、状態が更新される', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchAssignments } = useCalendarStore.getState();
      await fetchAssignments('2026-03-10', '2026-03-16');

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch assignments: HTTP', 500);
      expect(useCalendarStore.getState().projectsInitialized).toBe(true);
      expect(useCalendarStore.getState().projectsLoading).toBe(false);

      consoleSpy.mockRestore();
    });

    it('例外発生時にエラーログを出力する', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const { fetchAssignments } = useCalendarStore.getState();
      await fetchAssignments();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch assignments:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('addProject', () => {
    it('projectMasterIdがあり、workSchedulesがない場合、正常に割り当てを作成する', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/project-masters/')) {
          return { ok: true };
        }
        if (url.includes('/api/assignments')) {
          return {
            ok: true,
            json: async () => ({
              id: 'a1',
              projectMasterId: 'pm1',
              date: '2026-03-12T00:00:00.000Z',
              createdAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            }),
          };
        }
        return { ok: true };
      });

      // Setup initial store with a projectMaster
      useCalendarStore.setState({
        projectMasters: [{ id: 'pm1', assignmentCount: 0 } as any],
        assignments: [],
      });

      const { addProject } = useCalendarStore.getState();
      await addProject({
        id: 'temp',
        title: 'テスト案件',
        projectMasterId: 'pm1',
        startDate: new Date('2026-03-12'),
      } as any);

      const state = useCalendarStore.getState();
      expect(state.assignments).toHaveLength(1);
      expect(state.assignments[0].id).toBe('a1');
      // assignmentCountが同期されることの確認
      expect(state.projectMasters[0].assignmentCount).toBe(1);
    });

    it('projectMasterIdがなく、新規マスター作成およびworkSchedules一括作成を行う', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/project-masters?search=')) {
          return { ok: true, json: async () => [] };
        }
        if (url === '/api/project-masters') {
          return {
            ok: true,
            json: async () => ({
              id: 'new_pm',
              createdAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            }),
          };
        }
        if (url.includes('/api/assignments/batch-create')) {
          return {
            ok: true,
            json: async () => ([
              {
                id: 'a1',
                projectMasterId: 'new_pm',
                date: '2026-03-12T00:00:00.000Z',
                createdAt: '2026-03-12T00:00:00.000Z',
                updatedAt: '2026-03-12T00:00:00.000Z',
              },
              {
                id: 'a2',
                projectMasterId: 'new_pm',
                date: '2026-03-13T00:00:00.000Z',
                createdAt: '2026-03-12T00:00:00.000Z',
                updatedAt: '2026-03-12T00:00:00.000Z',
              }
            ]),
          };
        }
        return { ok: true };
      });

      const { addProject } = useCalendarStore.getState();
      await addProject({
        id: 'temp',
        title: '新規案件',
        workSchedules: [
          { dailySchedules: [{ date: '2026-03-12' }, { date: '2026-03-13' }] }
        ]
      } as any);

      const state = useCalendarStore.getState();
      // PMが1つ追加されている
      expect(state.projectMasters).toHaveLength(1);
      expect(state.projectMasters[0].id).toBe('new_pm');
      expect(state.projectMasters[0].assignmentCount).toBe(2); // 一括作成で2つ
      expect(state.assignments).toHaveLength(2);
      expect(sendBroadcast).toHaveBeenCalledWith('project_master_updated', { id: 'new_pm' });
    });

    it('projectMasterIdがなく、既存マスターが見つかり更新を行う', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/project-masters?search=')) {
          return { ok: true, json: async () => [{ id: 'exist_pm', title: '既存案件', constructionType: 'survey' }] };
        }
        if (url.includes('/api/project-masters/exist_pm')) {
          return { ok: true };
        }
        if (url.includes('/api/assignments')) {
          return {
            ok: true,
            json: async () => ({ id: 'a1', createdAt: '2026-03-12T00:00:00.000Z', updatedAt: '2026-03-12T00:00:00.000Z' }),
          };
        }
        return { ok: true };
      });

      const { addProject } = useCalendarStore.getState();
      await addProject({
        id: 'temp',
        title: '既存案件',
        constructionType: 'assembly', // differences trigger patch
        createdBy: 'user1',
      } as any);

      expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/exist_pm', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    it('一括作成(batch-create)でエラー配列以外が返された場合Errorを投げる', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/project-masters?search=')) {
          return { ok: true, json: async () => [] };
        }
        if (url.includes('/api/project-masters')) {
          return { ok: true, json: async () => ({ id: 'new_pm' }) }; // create master OK
        }
        if (url.includes('/api/assignments/batch-create')) {
          return { ok: true, json: async () => ({ notAnArray: true }) }; // invalid format
        }
        return { ok: true };
      });

      const { addProject } = useCalendarStore.getState();
      await expect(addProject({
        id: 't1', title: 'T1', workSchedules: [{ dailySchedules: [{ date: '2026-03-12' }] }]
      } as any)).rejects.toThrow('Invalid response: expected array of assignments');
    });

    it('一括作成APIでエラーが返された場合Errorを投げる', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/assignments/batch-create')) {
          return { ok: false };
        }
        return { ok: true, json: async () => ({ id: 'pm' }) };
      });

      const { addProject } = useCalendarStore.getState();
      await expect(addProject({
        id: 't1', title: 'T1', projectMasterId: 'pm1', workSchedules: [{ dailySchedules: [{ date: '2026-03-12' }] }]
      } as any)).rejects.toThrow('Failed to create assignments');
    });

    it('単発作成APIでエラーが返された場合Errorを投げる', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/assignments') && !url.includes('batch-create')) {
          return { ok: false, status: 500 };
        }
        return { ok: true, json: async () => ({ id: 'pm' }) };
      });

      const { addProject } = useCalendarStore.getState();
      await expect(addProject({ id: 't1', title: 'T1', projectMasterId: 'pm1' } as any)).rejects.toThrow('Failed to create assignment');
    });
  });

  describe('updateProject', () => {
    it('正常に更新できる', async () => {
      useCalendarStore.setState({
        assignments: [{ id: 'a1', date: new Date('2026-03-12') } as any],
      });

      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/assignments/')) {
          return {
            ok: true,
            json: async () => ({
              id: 'a1',
              date: '2026-03-13T00:00:00.000Z',
              createdAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-13T00:00:00.000Z',
            }),
          };
        }
        return { ok: true };
      });

      const { updateProject } = useCalendarStore.getState();
      await updateProject('a1', { startDate: new Date('2026-03-13') } as any);

      const state = useCalendarStore.getState();
      expect(state.assignments[0].date).toEqual(new Date('2026-03-13T00:00:00.000Z'));
    });

    it('409 Conflictエラー時にConflictUpdateErrorをスローする', async () => {
      useCalendarStore.setState({
        assignments: [{ id: 'a1', date: new Date('2026-03-12') } as any],
      });

      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/assignments/')) {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Conflict', latestData: {} }),
          };
        }
        return { ok: true };
      });

      const { updateProject } = useCalendarStore.getState();
      await expect(updateProject('a1', { startDate: new Date('2026-03-13') } as any)).rejects.toThrow(ConflictUpdateError);

      // Rollback checks
      const state = useCalendarStore.getState();
      expect(state.assignments[0].date).toEqual(new Date('2026-03-12')); // rolled back
    });

    it('既存のprojectMaster更新を伴う変更で、APIエラーが発生した場合Errorを投げる', async () => {
      useCalendarStore.setState({ assignments: [{ id: 'a1', date: new Date(), projectMasterId: 'pm1' } as any] });
      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/project-masters/pm1')) {
          return { ok: false };
        }
        return { ok: true };
      });

      const { updateProject } = useCalendarStore.getState();
      await expect(updateProject('a1', { title: 'New Title' } as any)).rejects.toThrow();
    });

    it('担当者変更等のisMoving=true時の処理検証', async () => {
      useCalendarStore.setState({ assignments: [{ id: 'a1', assignedEmployeeId: 'e1' } as any] });
      (global.fetch as jest.Mock).mockImplementation(async () => {
        return {
          ok: true,
          json: async () => ({ id: 'a1', date: '2026-03-13T00:00:00Z', createdAt: '2026-03-13T00:00:00Z', updatedAt: '2026-03-13T00:00:00Z' }),
        };
      });

      const { updateProject } = useCalendarStore.getState();
      // changing assignedEmployeeId
      await updateProject('a1', { assignedEmployeeId: 'e2' } as any);

      const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls.find(call => call[0].includes('/api/assignments/a1'))[1].body);
      expect(requestBody.isDispatchConfirmed).toBe(false);
      expect(requestBody.confirmedWorkerIds).toEqual([]);
    });

    it('単発更新APIでエラーが返された場合例外を投げる', async () => {
      useCalendarStore.setState({ assignments: [{ id: 'a1' } as any] });
      (global.fetch as jest.Mock).mockImplementation(async () => ({ ok: false, status: 500 }));

      const { updateProject } = useCalendarStore.getState();
      await expect(updateProject('a1', {} as any)).rejects.toThrow('Failed to update assignment');
    });
  });

  describe('updateProjects (batch update)', () => {
    it('正常に複数更新できる', async () => {
      useCalendarStore.setState({
        assignments: [
          { id: 'a1', date: new Date('2026-03-12') } as any,
          { id: 'a2', date: new Date('2026-03-13') } as any,
        ],
      });

      (global.fetch as jest.Mock).mockImplementation(async (url) => {
        if (url.includes('/api/assignments/batch')) {
          return {
            ok: true,
            json: async () => ({
              results: [
                { id: 'a1', updatedAt: '2026-03-14T00:00:00Z' },
                { id: 'a2', updatedAt: '2026-03-14T00:00:00Z' },
              ]
            }),
          };
        }
        return { ok: true };
      });

      const { updateProjects } = useCalendarStore.getState();
      await updateProjects([
        { id: 'a1', data: { startDate: new Date('2026-03-15') } as any },
      ]);

      const state = useCalendarStore.getState();
      expect(state.assignments[0].updatedAt).toEqual(new Date('2026-03-14T00:00:00Z'));
    });

    it('409 Conflictエラー時にConflictUpdateErrorをスローしてロールバック', async () => {
      useCalendarStore.setState({ assignments: [{ id: 'a1', date: new Date('2026-03-12') } as any] });

      (global.fetch as jest.Mock).mockImplementation(async () => {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'Conflict', latestData: {} }),
        };
      });

      const { updateProjects } = useCalendarStore.getState();
      await expect(updateProjects([{ id: 'a1', data: {} as any }])).rejects.toThrow(ConflictUpdateError);

      expect(useCalendarStore.getState().assignments[0].date).toEqual(new Date('2026-03-12'));
    });

    it('APIエラー時にErrorを投げてロールバック', async () => {
      useCalendarStore.setState({ assignments: [{ id: 'a1', date: new Date('2026-03-12') } as any] });
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

      const { updateProjects } = useCalendarStore.getState();
      await expect(updateProjects([{ id: 'a1', data: {} as any }])).rejects.toThrow('Failed to update assignments');

      expect(useCalendarStore.getState().assignments[0].date).toEqual(new Date('2026-03-12'));
    });
  });

  describe('deleteProject', () => {
    it('正常に削除できる', async () => {
       useCalendarStore.setState({
         assignments: [{ id: 'a1' } as any, { id: 'a2' } as any],
       });

       (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

       const { deleteProject } = useCalendarStore.getState();
       await deleteProject('a1');

       const state = useCalendarStore.getState();
       expect(state.assignments).toHaveLength(1);
       expect(state.assignments[0].id).toBe('a2');
    });

    it('削除APIエラー時に例外を投げる', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
      const { deleteProject } = useCalendarStore.getState();
      await expect(deleteProject('a1')).rejects.toThrow('Failed to delete assignment');
    });
  });

  describe('Other getters and setters', () => {
    it('getCalendarEvents, getProjects', () => {
       useCalendarStore.setState({ assignments: [{ id: 'a1', date: new Date() } as any] });
       const { getCalendarEvents, getProjects } = useCalendarStore.getState();
       expect(getCalendarEvents()).toHaveLength(1);
       expect(getProjects()).toHaveLength(1);
    });

    it('upsertAssignment', () => {
       useCalendarStore.setState({ assignments: [{ id: 'a1', remarks: 'old' } as any] });
       const { upsertAssignment } = useCalendarStore.getState();
       
       upsertAssignment({ id: 'a1', remarks: 'new' } as any);
       expect(useCalendarStore.getState().assignments[0].remarks).toBe('new');

       upsertAssignment({ id: 'a2', remarks: 'new2' } as any);
       expect(useCalendarStore.getState().assignments).toHaveLength(2);
    });

    it('getProjectById', () => {
       useCalendarStore.setState({ assignments: [{ id: 'a1', date: new Date() } as any] });
       const { getProjectById } = useCalendarStore.getState();
       expect(getProjectById('a1')).toBeDefined();
       expect(getProjectById('not_found')).toBeUndefined();
    });

    it('removeAssignmentById', () => {
       useCalendarStore.setState({ assignments: [{ id: 'a1' } as any] });
       const { removeAssignmentById } = useCalendarStore.getState();
       removeAssignmentById('a1');
       expect(useCalendarStore.getState().assignments).toHaveLength(0);
    });

    it('updateProjectMasterInAssignments', () => {
       useCalendarStore.setState({ assignments: [{ id: 'a1', projectMasterId: 'pm1' } as any] });
       const { updateProjectMasterInAssignments } = useCalendarStore.getState();
       updateProjectMasterInAssignments({ id: 'pm1', title: 'updated pm' } as any);
       expect(useCalendarStore.getState().assignments[0].projectMaster?.title).toBe('updated pm');
    });
  });
});
