/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSession } from 'next-auth/react';
import { useMasterStore } from '@/stores/masterStore';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/calendarStore');
jest.mock('@/stores/masterStore');

describe('useProjects', () => {
    const mockFetchAssignments = jest.fn();
    const mockAddProject = jest.fn();
    const mockUpdateProject = jest.fn();
    const mockUpdateProjects = jest.fn();
    const mockDeleteProject = jest.fn();
    const mockGetProjectById = jest.fn();
    const mockGetCalendarEvents = jest.fn();

    const mockAssignments = [
        {
            id: 'a1',
            date: new Date('2023-01-01'),
            assignedEmployeeId: 'emp1',
            projectMasterId: 'pm1',
            createdAt: new Date(),
            updatedAt: new Date(),
            projectMaster: {
                id: 'pm1',
                title: 'Project 1',
                constructionType: 'assembly',
                customerName: 'Customer 1',
            },
            workers: ['w1'],
            vehicles: ['v1'],
        }
    ];

    const mockConstructionTypes = [
        { id: 'assembly', name: 'Assembly', color: '#ff0000' }
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated' });

        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector) => {
            const state = {
                projectsLoading: false,
                projectsInitialized: true,
                assignments: mockAssignments,
                fetchAssignments: mockFetchAssignments,
                addProject: mockAddProject,
                updateProject: mockUpdateProject,
                updateProjects: mockUpdateProjects,
                deleteProject: mockDeleteProject,
                getProjectById: mockGetProjectById,
                getCalendarEvents: mockGetCalendarEvents,
            };
            return selector(state);
        });

        (useMasterStore as unknown as jest.Mock).mockImplementation((selector) => {
            const state = {
                constructionTypes: mockConstructionTypes
            };
            return selector(state);
        });
    });

    it('should return transformed projects with correct color and properties', () => {
        const { result } = renderHook(() => useProjects());

        expect(result.current.projects).toHaveLength(1);
        expect(result.current.projects[0]).toEqual(expect.objectContaining({
            id: 'a1',
            title: 'Project 1',
            startDate: expect.any(Date),
            color: '#ff0000', // From mockConstructionTypes
            constructionType: 'assembly',
            workers: ['w1'],
            vehicles: ['v1'],
        }));
    });

    it('should expose store actions and state', () => {
        const { result } = renderHook(() => useProjects());

        expect(result.current.addProject).toBeDefined();
        expect(result.current.updateProject).toBeDefined();
        expect(result.current.deleteProject).toBeDefined();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(true);
    });

    it('should fetch assignments for date range', async () => {
        const { result } = renderHook(() => useProjects());
        const start = new Date('2023-01-01');
        const end = new Date('2023-01-07');

        await waitFor(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        expect(mockFetchAssignments).toHaveBeenCalledWith(
            '2023-01-01',
            '2023-01-07'
        );
    });

    it('should skip fetching if same range is requested', async () => {
        const { result } = renderHook(() => useProjects());
        const start = new Date('2023-01-01');
        const end = new Date('2023-01-07');

        await waitFor(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        // Call again with same range
        await waitFor(async () => {
            await result.current.fetchForDateRange(start, end);
        });

        expect(mockFetchAssignments).toHaveBeenCalledTimes(1);
    });

    it('should call store addProject', async () => {
        const { result } = renderHook(() => useProjects());
        const newProject = { title: 'New Project' };

        await waitFor(async () => {
            await result.current.addProject(newProject as any);
        });

        expect(mockAddProject).toHaveBeenCalledWith(newProject);
    });

    it('should call store updateProject', async () => {
        const { result } = renderHook(() => useProjects());
        const updates = { title: 'Updated' };

        await waitFor(async () => {
            await result.current.updateProject('a1', updates);
        });

        expect(mockUpdateProject).toHaveBeenCalledWith('a1', updates);
    });

    it('should call store deleteProject', async () => {
        const { result } = renderHook(() => useProjects());

        await waitFor(async () => {
            await result.current.deleteProject('a1');
        });

        expect(mockDeleteProject).toHaveBeenCalledWith('a1');
    });
});
