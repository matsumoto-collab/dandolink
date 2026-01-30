import { renderHook, act, waitFor } from '@testing-library/react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/calendarStore');
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
    },
}));

describe('useProjects', () => {
    // Store mock functions
    const mockFetchAssignments = jest.fn();
    const mockAddProject = jest.fn();
    const mockUpdateProject = jest.fn();
    const mockUpdateProjects = jest.fn();
    const mockDeleteProject = jest.fn();
    const mockGetProjectById = jest.fn();
    const mockGetCalendarEvents = jest.fn();

    // Default store state
    const defaultStoreState = {
        projectsLoading: false,
        projectsInitialized: true,
        assignments: [],
        fetchAssignments: mockFetchAssignments,
        addProject: mockAddProject,
        updateProject: mockUpdateProject,
        updateProjects: mockUpdateProjects,
        deleteProject: mockDeleteProject,
        getProjectById: mockGetProjectById,
        getCalendarEvents: mockGetCalendarEvents,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', data: { user: { id: 'test-user' } } });

        // Setup useCalendarStore mock
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(defaultStoreState);
        });
    });

    it('should initialize and return state from store', () => {
        const { result } = renderHook(() => useProjects());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(true);
        expect(result.current.projects).toEqual([]);
    });

    it('should call fetchAssignments when fetchForDateRange is called', async () => {
        const { result } = renderHook(() => useProjects());
        const start = new Date('2024-01-01');
        const end = new Date('2024-01-07');

        await act(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        expect(mockFetchAssignments).toHaveBeenCalledWith('2024-01-01', '2024-01-07');
    });

    it('should not recall fetchAssignments for the same date range', async () => {
        const { result } = renderHook(() => useProjects());
        const start = new Date('2024-01-01');
        const end = new Date('2024-01-07');

        await act(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        // Call again with same range
        await act(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        expect(mockFetchAssignments).toHaveBeenCalledTimes(1);
    });

    it('should call store actions', async () => {
        const { result } = renderHook(() => useProjects());

        await act(async () => {
            await result.current.addProject({ title: 'New' } as any);
        });
        expect(mockAddProject).toHaveBeenCalled();
        expect(mockFetchAssignments).toHaveBeenCalled(); // Should refresh after add

        await act(async () => {
            await result.current.updateProject('1', { title: 'Updated' });
        });
        expect(mockUpdateProject).toHaveBeenCalledWith('1', { title: 'Updated' });

        await act(async () => {
            await result.current.deleteProject('1');
        });
        expect(mockDeleteProject).toHaveBeenCalledWith('1');
    });

    it('should transform assignments to projects correctly', () => {
        const mockAssignments = [
            {
                id: '1',
                date: new Date('2024-01-01'),
                projectMaster: {
                    title: 'Test Project',
                    constructionType: 'assembly',
                },
                workers: ['w1'],
                vehicles: ['v1'],
            }
        ];

        // Update store mock to return assignments
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({
                ...defaultStoreState,
                assignments: mockAssignments,
            });
        });

        const { result } = renderHook(() => useProjects());

        expect(result.current.projects).toHaveLength(1);
        expect(result.current.projects[0].title).toBe('Test Project');
        expect(result.current.projects[0].constructionType).toBe('assembly');
        expect(result.current.projects[0].workers).toEqual(['w1']);
    });
});
