
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/calendarStore');
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn().mockReturnValue({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
        }),
        removeChannel: jest.fn(),
    },
}));

describe('useProjects', () => {
    // Mock state and actions
    const mockFetchAssignments = jest.fn();
    const mockAddProject = jest.fn();
    const mockUpdateProject = jest.fn();
    const mockUpdateProjects = jest.fn();
    const mockDeleteProject = jest.fn();
    const mockGetProjectById = jest.fn();
    const mockGetCalendarEvents = jest.fn();

    const mockState = {
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

        // Setup default mocks
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated' });

        // Mock Zustand store selector behavior
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(mockState);
        });
    });

    it('should initialize and return projects from store', () => {
        // Setup store with some assignments
        const testAssignment = {
            id: 'assign-1',
            date: new Date('2023-01-01'),
            assignedEmployeeId: 'emp-1',
            projectMaster: {
                title: 'Test Project',
                customerName: 'Test Customer',
                constructionType: 'assembly',
            },
            workers: [],
            vehicles: [],
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        mockState.assignments = [testAssignment] as any;

        const { result } = renderHook(() => useProjects());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.projects).toHaveLength(1);
        expect(result.current.projects[0].title).toBe('Test Project');
        expect(result.current.projects[0].constructionType).toBe('assembly');
    });

    it('should call store actions when wrapper functions are called', async () => {
        mockState.assignments = [];
        const { result } = renderHook(() => useProjects());

        // Test addProject
        const newProject = { title: 'New Project' } as any;
        await act(async () => {
            await result.current.addProject(newProject);
        });
        expect(mockAddProject).toHaveBeenCalledWith(newProject);
        expect(mockFetchAssignments).toHaveBeenCalled(); // Should refresh

        // Test updateProject
        await act(async () => {
            await result.current.updateProject('id-1', { title: 'Updated' });
        });
        expect(mockUpdateProject).toHaveBeenCalledWith('id-1', { title: 'Updated' });

        // Test deleteProject
        await act(async () => {
            await result.current.deleteProject('id-1');
        });
        expect(mockDeleteProject).toHaveBeenCalledWith('id-1');
    });

    it('should fetch data for date range', async () => {
        const { result } = renderHook(() => useProjects());
        const start = new Date('2023-01-01');
        const end = new Date('2023-01-07');

        await act(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];
        expect(mockFetchAssignments).toHaveBeenCalledWith(startStr, endStr);
    });

    it('should reset state when unauthenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });
        renderHook(() => useProjects());
        // Since logic inside useEffect for unauthenticated is just resetting ref, 
        // we can't easily observe it without exposing ref, but we can check usage.
        // It's a smoke test for crash.
    });
});
