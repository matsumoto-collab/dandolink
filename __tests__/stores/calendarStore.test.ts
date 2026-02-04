import { act } from '@testing-library/react';
import { useCalendarStore } from '@/stores/calendarStore';

// Mock global fetch
global.fetch = jest.fn();

describe('calendarStore', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        act(() => {
            useCalendarStore.getState().reset();
        });
    });

    describe('Project Masters', () => {
        const mockProjectMaster = {
            id: '1',
            title: 'Project 1',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z',
            customerName: 'Customer A'
        };

        it('fetchProjectMasters: should fetch and set project masters', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockProjectMaster],
            });

            await act(async () => {
                await useCalendarStore.getState().fetchProjectMasters();
            });

            const state = useCalendarStore.getState();
            expect(state.projectMasters).toHaveLength(1);
            expect(state.projectMasters[0].title).toBe('Project 1');
            expect(state.projectMasters[0].createdAt).toBeInstanceOf(Date);
        });

        it('createProjectMaster: should add new project master', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockProjectMaster,
            });

            await act(async () => {
                await useCalendarStore.getState().createProjectMaster({
                    title: 'Project 1',
                    customerName: 'Customer A',
                } as any);
            });

            const state = useCalendarStore.getState();
            expect(state.projectMasters).toHaveLength(1);
            expect(global.fetch).toHaveBeenCalledWith('/api/project-masters', expect.objectContaining({
                method: 'POST',
            }));
        });

        it('updateProjectMaster: should update existing project master', async () => {
            // First set initial state
            useCalendarStore.setState({
                projectMasters: [{
                    ...mockProjectMaster,
                    createdAt: new Date(mockProjectMaster.createdAt),
                    updatedAt: new Date(mockProjectMaster.updatedAt)
                }]
            } as any);

            const updatedMaster = { ...mockProjectMaster, title: 'Updated Project' };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedMaster,
            });

            await act(async () => {
                await useCalendarStore.getState().updateProjectMaster('1', { title: 'Updated Project' });
            });

            const state = useCalendarStore.getState();
            expect(state.projectMasters[0].title).toBe('Updated Project');
            expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/1', expect.objectContaining({
                method: 'PATCH',
            }));
        });

        it('deleteProjectMaster: should remove project master', async () => {
            useCalendarStore.setState({
                projectMasters: [{
                    ...mockProjectMaster,
                    createdAt: new Date(mockProjectMaster.createdAt),
                    updatedAt: new Date(mockProjectMaster.updatedAt)
                }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useCalendarStore.getState().deleteProjectMaster('1');
            });

            const state = useCalendarStore.getState();
            expect(state.projectMasters).toHaveLength(0);
            expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/1', expect.objectContaining({
                method: 'DELETE',
            }));
        });
    });

    describe('Assignments (Projects)', () => {
        const mockAssignment = {
            id: 'a1',
            date: '2023-01-01T00:00:00.000Z',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z',
            projectMasterId: 'pm1',
            projectMaster: {
                id: 'pm1',
                title: 'Project 1',
                createdAt: '2023-01-01',
                updatedAt: '2023-01-01',
                constructionType: 'assembly'
            }
        };

        it('fetchAssignments: should fetch and set assignments', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockAssignment],
            });

            await act(async () => {
                await useCalendarStore.getState().fetchAssignments();
            });

            const state = useCalendarStore.getState();
            expect(state.assignments).toHaveLength(1);
            expect(state.assignments[0].date).toBeInstanceOf(Date);
        });

        it('addProject: should create assignment and add to local state', async () => {
            const mockNewAssignment = {
                id: 'new-a1',
                date: '2023-01-01T00:00:00.000Z',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-01-01T00:00:00.000Z',
                projectMasterId: 'pm1',
                projectMaster: {
                    id: 'pm1',
                    title: 'Existing Project',
                    createdAt: '2023-01-01T00:00:00.000Z',
                    updatedAt: '2023-01-01T00:00:00.000Z',
                }
            };

            // Mock for project search and assignment creation
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'pm1', title: 'Existing Project' }] }) // search
                .mockResolvedValueOnce({ ok: true, json: async () => mockNewAssignment }); // post assignment

            await act(async () => {
                await useCalendarStore.getState().addProject({
                    title: 'Existing Project',
                    startDate: new Date('2023-01-01'),
                } as any);
            });

            expect(global.fetch).toHaveBeenCalledWith('/api/assignments', expect.any(Object));
            // Verify assignment was added directly to local state
            const state = useCalendarStore.getState();
            expect(state.assignments).toHaveLength(1);
            expect(state.assignments[0].id).toBe('new-a1');
            expect(state.assignments[0].date).toBeInstanceOf(Date);
        });

        it('updateProject: should verify optimistic update and API call', async () => {
            useCalendarStore.setState({
                assignments: [{
                    ...mockAssignment,
                    date: new Date(mockAssignment.date),
                    createdAt: new Date(mockAssignment.createdAt),
                    updatedAt: new Date(mockAssignment.updatedAt)
                }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            const newDate = new Date('2023-02-01T00:00:00.000Z');

            await act(async () => {
                const promise = useCalendarStore.getState().updateProject('a1', { startDate: newDate });
                // Check optimistic update immediately (might happen before promise resolves in real app, strictly sequential here due to await)
                // Actually await ensures state is updated if set calls are sync or batched React-style. Zustand updates are sync.
                const state = useCalendarStore.getState();
                expect(state.assignments[0].date).toBe(newDate); // Optimistic verified
                await promise;
            });

            expect(global.fetch).toHaveBeenCalledWith('/api/assignments/a1', expect.objectContaining({
                method: 'PATCH',
                body: expect.stringContaining('2023-02-01')
            }));
        });

        it('updateProject: should rollback on failure', async () => {
            const originalDate = new Date(mockAssignment.date);
            useCalendarStore.setState({
                assignments: [{
                    ...mockAssignment,
                    date: originalDate,
                    createdAt: new Date(mockAssignment.createdAt),
                    updatedAt: new Date(mockAssignment.updatedAt)
                }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'Error' })
            });

            const newDate = new Date('2023-02-01T00:00:00.000Z');

            await expect(async () => {
                await act(async () => {
                    await useCalendarStore.getState().updateProject('a1', { startDate: newDate });
                });
            }).rejects.toThrow();

            const state = useCalendarStore.getState();
            expect(state.assignments[0].date).toEqual(originalDate); // Rollback verified
        });
    });

    describe('Daily Reports', () => {
        const mockReport = {
            id: 'dr1',
            date: '2023-01-01',
            content: 'Report Content',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z'
        };

        it('fetchDailyReports: should fetch and set reports', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockReport],
            });

            await act(async () => {
                await useCalendarStore.getState().fetchDailyReports();
            });

            const state = useCalendarStore.getState();
            expect(state.dailyReports).toHaveLength(1);
            expect(state.dailyReports[0].date).toBeInstanceOf(Date);
        });

        it('saveDailyReport: should save and update store', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockReport,
            });

            await act(async () => {
                await useCalendarStore.getState().saveDailyReport({
                    date: '2023-01-01',
                    content: 'Report Content'
                } as any);
            });

            const state = useCalendarStore.getState();
            expect(state.dailyReports).toHaveLength(1);
            expect(global.fetch).toHaveBeenCalledWith('/api/daily-reports', expect.objectContaining({
                method: 'POST'
            }));
        });

        it('deleteDailyReport: should remove report', async () => {
            useCalendarStore.setState({
                dailyReports: [{
                    ...mockReport,
                    date: new Date(mockReport.date),
                    createdAt: new Date(mockReport.createdAt),
                    updatedAt: new Date(mockReport.updatedAt)
                }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useCalendarStore.getState().deleteDailyReport('dr1');
            });

            const state = useCalendarStore.getState();
            expect(state.dailyReports).toHaveLength(0);
        });
    });

    describe('Foreman Settings', () => {
        it('fetchForemanSettings: should set displayedForemanIds', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ displayedForemanIds: ['emp1', 'emp2'] }),
            });

            await act(async () => {
                await useCalendarStore.getState().fetchForemanSettings();
            });

            const state = useCalendarStore.getState();
            expect(state.displayedForemanIds).toEqual(['emp1', 'emp2']);
        });

        it('addForeman: should add id and call API', async () => {
            useCalendarStore.setState({ displayedForemanIds: ['emp1'] } as any);
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useCalendarStore.getState().addForeman('emp2');
            });

            const state = useCalendarStore.getState();
            expect(state.displayedForemanIds).toEqual(['emp1', 'emp2']);
            expect(global.fetch).toHaveBeenCalledWith('/api/user-settings', expect.objectContaining({
                method: 'PATCH',
                body: expect.stringContaining('emp2')
            }));
        });

        it('removeForeman: should removing id and call API', async () => {
            useCalendarStore.setState({ displayedForemanIds: ['emp1', 'emp2'] } as any);
            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useCalendarStore.getState().removeForeman('emp1');
            });

            const state = useCalendarStore.getState();
            expect(state.displayedForemanIds).toEqual(['emp2']);
            expect(global.fetch).toHaveBeenCalledWith('/api/user-settings', expect.objectContaining({
                method: 'PATCH'
            }));
        });
    });
});
