import { renderHook } from '@testing-library/react';
import { useMasterData } from '@/hooks/useMasterData';
import { useMasterStore } from '@/stores/masterStore';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/masterStore');

describe('useMasterData', () => {
    // Store mock functions
    const mockFetchMasterData = jest.fn();
    const mockRefreshMasterData = jest.fn();
    const mockAddVehicle = jest.fn();
    const mockUpdateVehicle = jest.fn();
    const mockDeleteVehicle = jest.fn();
    const mockAddWorker = jest.fn();
    const mockUpdateWorker = jest.fn();
    const mockDeleteWorker = jest.fn();
    const mockAddManager = jest.fn();
    const mockUpdateManager = jest.fn();
    const mockDeleteManager = jest.fn();
    const mockUpdateTotalMembers = jest.fn();
    const mockSetupRealtimeSubscription = jest.fn();

    // Default store state
    const defaultStoreState = {
        vehicles: [],
        workers: [],
        managers: [],
        totalMembers: 0,
        isLoading: false,
        isInitialized: false,
        fetchMasterData: mockFetchMasterData,
        refreshMasterData: mockRefreshMasterData,
        addVehicle: mockAddVehicle,
        updateVehicle: mockUpdateVehicle,
        deleteVehicle: mockDeleteVehicle,
        addWorker: mockAddWorker,
        updateWorker: mockUpdateWorker,
        deleteWorker: mockDeleteWorker,
        addManager: mockAddManager,
        updateManager: mockUpdateManager,
        deleteManager: mockDeleteManager,
        updateTotalMembers: mockUpdateTotalMembers,
        setupRealtimeSubscription: mockSetupRealtimeSubscription,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', data: { user: { id: 'test-user' } } });

        // Setup useMasterStore mock
        (useMasterStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(defaultStoreState);
        });
    });

    it('should initialize and return state from store', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.vehicles).toEqual([]);
        expect(result.current.workers).toEqual([]);
        expect(result.current.managers).toEqual([]);
        expect(result.current.totalMembers).toBe(0);
    });

    it('should auto-fetch master data when authenticated and not initialized', () => {
        renderHook(() => useMasterData());

        expect(mockFetchMasterData).toHaveBeenCalled();
    });

    it('should setup realtime subscription when authenticated', () => {
        renderHook(() => useMasterData());

        expect(mockSetupRealtimeSubscription).toHaveBeenCalled();
    });

    it('should not fetch when not authenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        renderHook(() => useMasterData());

        expect(mockFetchMasterData).not.toHaveBeenCalled();
    });

    it('should not fetch when already initialized', () => {
        (useMasterStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, isInitialized: true });
        });

        renderHook(() => useMasterData());

        expect(mockFetchMasterData).not.toHaveBeenCalled();
    });

    it('should expose vehicle operations', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.addVehicle).toBe(mockAddVehicle);
        expect(result.current.updateVehicle).toBe(mockUpdateVehicle);
        expect(result.current.deleteVehicle).toBe(mockDeleteVehicle);
    });

    it('should expose worker operations', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.addWorker).toBe(mockAddWorker);
        expect(result.current.updateWorker).toBe(mockUpdateWorker);
        expect(result.current.deleteWorker).toBe(mockDeleteWorker);
    });

    it('should expose manager operations', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.addManager).toBe(mockAddManager);
        expect(result.current.updateManager).toBe(mockUpdateManager);
        expect(result.current.deleteManager).toBe(mockDeleteManager);
    });

    it('should expose updateTotalMembers', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.updateTotalMembers).toBe(mockUpdateTotalMembers);
    });

    it('should expose refreshMasterData', () => {
        const { result } = renderHook(() => useMasterData());

        expect(result.current.refreshMasterData).toBe(mockRefreshMasterData);
    });

    it('should return data from store', () => {
        const mockVehicles = [{ id: 'v1', name: 'Truck 1' }];
        const mockWorkers = [{ id: 'w1', name: 'Worker 1' }];
        const mockManagers = [{ id: 'm1', name: 'Manager 1' }];

        (useMasterStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({
                ...defaultStoreState,
                vehicles: mockVehicles,
                workers: mockWorkers,
                managers: mockManagers,
                totalMembers: 10,
            });
        });

        const { result } = renderHook(() => useMasterData());

        expect(result.current.vehicles).toEqual(mockVehicles);
        expect(result.current.workers).toEqual(mockWorkers);
        expect(result.current.managers).toEqual(mockManagers);
        expect(result.current.totalMembers).toBe(10);
    });
});
