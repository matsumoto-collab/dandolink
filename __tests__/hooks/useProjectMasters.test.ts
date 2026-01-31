import { renderHook, act } from '@testing-library/react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
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

describe('useProjectMasters', () => {
    // Store mock functions
    const mockFetchProjectMasters = jest.fn();
    const mockCreateProjectMaster = jest.fn();
    const mockUpdateProjectMaster = jest.fn();
    const mockDeleteProjectMaster = jest.fn();
    const mockGetProjectMasterById = jest.fn();

    // Default store state
    const defaultStoreState = {
        projectMasters: [],
        projectMastersLoading: false,
        projectMastersError: null,
        projectMastersInitialized: false,
        fetchProjectMasters: mockFetchProjectMasters,
        createProjectMaster: mockCreateProjectMaster,
        updateProjectMaster: mockUpdateProjectMaster,
        deleteProjectMaster: mockDeleteProjectMaster,
        getProjectMasterById: mockGetProjectMasterById,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', data: { user: { id: 'test-user' } } });

        // Setup useCalendarStore mock
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(defaultStoreState);
        });

        // Mock window event listener
        jest.spyOn(window, 'addEventListener').mockImplementation(() => { });
        jest.spyOn(window, 'removeEventListener').mockImplementation(() => { });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should initialize and return state from store', () => {
        const { result } = renderHook(() => useProjectMasters());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.projectMasters).toEqual([]);
    });

    it('should auto-fetch project masters when authenticated and not initialized', () => {
        renderHook(() => useProjectMasters());

        expect(mockFetchProjectMasters).toHaveBeenCalled();
    });

    it('should not auto-fetch when not authenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        renderHook(() => useProjectMasters());

        expect(mockFetchProjectMasters).not.toHaveBeenCalled();
    });

    it('should not auto-fetch when already initialized', () => {
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, projectMastersInitialized: true });
        });

        renderHook(() => useProjectMasters());

        expect(mockFetchProjectMasters).not.toHaveBeenCalled();
    });

    it('should call fetchProjectMasters with search and status filter', async () => {
        const { result } = renderHook(() => useProjectMasters());

        await act(async () => {
            await result.current.fetchProjectMasters('test search', 'active');
        });

        expect(mockFetchProjectMasters).toHaveBeenCalledWith('test search', 'active');
    });

    it('should call createProjectMaster with correct data and return result', async () => {
        const newMaster = { id: 'pm-1', title: 'New Project' };
        mockCreateProjectMaster.mockResolvedValue(newMaster);

        const { result } = renderHook(() => useProjectMasters());
        const masterData = { title: 'New Project', customerName: 'Customer 1' };

        let returnedMaster;
        await act(async () => {
            returnedMaster = await result.current.createProjectMaster(masterData as any);
        });

        expect(mockCreateProjectMaster).toHaveBeenCalledWith(masterData);
        expect(returnedMaster).toEqual(newMaster);
    });

    it('should call updateProjectMaster with correct id and data', async () => {
        const updatedMaster = { id: 'pm-1', title: 'Updated Project' };
        mockUpdateProjectMaster.mockResolvedValue(updatedMaster);

        const { result } = renderHook(() => useProjectMasters());

        let returnedMaster;
        await act(async () => {
            returnedMaster = await result.current.updateProjectMaster('pm-1', { title: 'Updated Project' });
        });

        expect(mockUpdateProjectMaster).toHaveBeenCalledWith('pm-1', { title: 'Updated Project' });
        expect(returnedMaster).toEqual(updatedMaster);
    });

    it('should call deleteProjectMaster with correct id', async () => {
        const { result } = renderHook(() => useProjectMasters());

        await act(async () => {
            await result.current.deleteProjectMaster('pm-1');
        });

        expect(mockDeleteProjectMaster).toHaveBeenCalledWith('pm-1');
    });

    it('should expose getProjectMasterById from store', () => {
        const mockMaster = { id: 'pm-1', title: 'Project 1' };
        mockGetProjectMasterById.mockReturnValue(mockMaster);

        const { result } = renderHook(() => useProjectMasters());
        const master = result.current.getProjectMasterById('pm-1');

        expect(master).toEqual(mockMaster);
    });

    it('should return project masters from store', () => {
        const mockMasters = [
            { id: 'pm-1', title: 'Project 1' },
            { id: 'pm-2', title: 'Project 2' },
        ];

        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, projectMasters: mockMasters });
        });

        const { result } = renderHook(() => useProjectMasters());
        expect(result.current.projectMasters).toEqual(mockMasters);
    });

    it('should return error from store', () => {
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, projectMastersError: 'Failed to fetch' });
        });

        const { result } = renderHook(() => useProjectMasters());
        expect(result.current.error).toBe('Failed to fetch');
    });

    it('should setup projectMasterCreated event listener', () => {
        renderHook(() => useProjectMasters());

        expect(window.addEventListener).toHaveBeenCalledWith('projectMasterCreated', expect.any(Function));
    });

    it('should cleanup event listener on unmount', () => {
        const { unmount } = renderHook(() => useProjectMasters());

        unmount();

        expect(window.removeEventListener).toHaveBeenCalledWith('projectMasterCreated', expect.any(Function));
    });
});
