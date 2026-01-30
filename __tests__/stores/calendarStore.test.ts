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

    describe('fetchProjectMasters', () => {
        it('should fetch and set project masters', async () => {
            const mockData = [
                { id: '1', title: 'Project 1', createdAt: '2023-01-01', updatedAt: '2023-01-01' },
            ];
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockData,
            });

            await act(async () => {
                await useCalendarStore.getState().fetchProjectMasters();
            });

            const state = useCalendarStore.getState();
            expect(state.projectMasters).toHaveLength(1);
            expect(state.projectMasters[0].title).toBe('Project 1');
            expect(state.projectMasters[0].createdAt).toBeInstanceOf(Date);
        });

        it('should handle fetch errors', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
            });

            await act(async () => {
                await useCalendarStore.getState().fetchProjectMasters();
            });

            const state = useCalendarStore.getState();
            expect(state.projectMastersError).toBeDefined();
        });
    });

    describe('fetchAssignments', () => {
        it('should fetch and set assignments', async () => {
            const mockData = [
                {
                    id: 'a1',
                    date: '2023-01-01',
                    createdAt: '2023-01-01',
                    updatedAt: '2023-01-01',
                    projectMaster: {
                        id: 'pm1',
                        title: 'Project 1',
                        createdAt: '2023-01-01',
                        updatedAt: '2023-01-01',
                        constructionType: 'assembly'
                    }
                }
            ];
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockData,
            });

            await act(async () => {
                await useCalendarStore.getState().fetchAssignments();
            });

            const state = useCalendarStore.getState();
            expect(state.assignments).toHaveLength(1);
            expect(state.assignments[0].projectMaster?.title).toBe('Project 1');
        });
    });
});
