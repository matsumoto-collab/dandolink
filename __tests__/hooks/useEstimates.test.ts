import { renderHook, act } from '@testing-library/react';
import { useEstimates } from '@/hooks/useEstimates';
import { useFinanceStore } from '@/stores/financeStore';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/financeStore');
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

describe('useEstimates', () => {
    // Store mock functions
    const mockFetchEstimates = jest.fn();
    const mockAddEstimate = jest.fn();
    const mockUpdateEstimate = jest.fn();
    const mockDeleteEstimate = jest.fn();
    const mockGetEstimate = jest.fn();
    const mockGetEstimatesByProject = jest.fn();

    // Default store state
    const defaultStoreState = {
        estimates: [],
        estimatesLoading: false,
        estimatesInitialized: false,
        fetchEstimates: mockFetchEstimates,
        addEstimate: mockAddEstimate,
        updateEstimate: mockUpdateEstimate,
        deleteEstimate: mockDeleteEstimate,
        getEstimate: mockGetEstimate,
        getEstimatesByProject: mockGetEstimatesByProject,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', data: { user: { id: 'test-user' } } });

        // Setup useFinanceStore mock
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(defaultStoreState);
        });
    });

    it('should initialize and return state from store', () => {
        const { result } = renderHook(() => useEstimates());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.estimates).toEqual([]);
    });

    it('should return isInitialized true when store is initialized', () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, estimatesInitialized: true });
        });

        const { result } = renderHook(() => useEstimates());
        expect(result.current.isInitialized).toBe(true);
    });

    it('should call fetchEstimates when ensureDataLoaded is called and not initialized', async () => {
        const { result } = renderHook(() => useEstimates());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchEstimates).toHaveBeenCalledTimes(1);
    });

    it('should not call fetchEstimates when already initialized', async () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, estimatesInitialized: true });
        });

        const { result } = renderHook(() => useEstimates());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchEstimates).not.toHaveBeenCalled();
    });

    it('should not call fetchEstimates when not authenticated', async () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        const { result } = renderHook(() => useEstimates());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchEstimates).not.toHaveBeenCalled();
    });

    it('should call addEstimate with correct data and return result', async () => {
        const newEstimate = { id: 'new-1', title: 'New Estimate' };
        mockAddEstimate.mockResolvedValue(newEstimate);

        const { result } = renderHook(() => useEstimates());
        const estimateData = { title: 'New Estimate', projectId: 'proj-1' };

        let returnedEstimate;
        await act(async () => {
            returnedEstimate = await result.current.addEstimate(estimateData as any);
        });

        expect(mockAddEstimate).toHaveBeenCalledWith(estimateData);
        expect(returnedEstimate).toEqual(newEstimate);
    });

    it('should call updateEstimate with correct id and data', async () => {
        const { result } = renderHook(() => useEstimates());
        const updateData = { title: 'Updated Estimate' };

        await act(async () => {
            await result.current.updateEstimate('estimate-1', updateData);
        });

        expect(mockUpdateEstimate).toHaveBeenCalledWith('estimate-1', updateData);
    });

    it('should call deleteEstimate with correct id', async () => {
        const { result } = renderHook(() => useEstimates());

        await act(async () => {
            await result.current.deleteEstimate('estimate-1');
        });

        expect(mockDeleteEstimate).toHaveBeenCalledWith('estimate-1');
    });

    it('should call refreshEstimates and trigger fetch', async () => {
        const { result } = renderHook(() => useEstimates());

        await act(async () => {
            await result.current.refreshEstimates();
        });

        expect(mockFetchEstimates).toHaveBeenCalled();
    });

    it('should return estimates from store', () => {
        const mockEstimates = [
            { id: '1', title: 'Estimate 1' },
            { id: '2', title: 'Estimate 2' },
        ];

        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, estimates: mockEstimates });
        });

        const { result } = renderHook(() => useEstimates());
        expect(result.current.estimates).toEqual(mockEstimates);
    });

    it('should expose getEstimate from store', () => {
        const mockEstimate = { id: '1', title: 'Estimate 1' };
        mockGetEstimate.mockReturnValue(mockEstimate);

        const { result } = renderHook(() => useEstimates());
        const estimate = result.current.getEstimate('1');

        expect(estimate).toEqual(mockEstimate);
    });

    it('should expose getEstimatesByProject from store', () => {
        const mockEstimates = [{ id: '1', title: 'Estimate 1', projectId: 'proj-1' }];
        mockGetEstimatesByProject.mockReturnValue(mockEstimates);

        const { result } = renderHook(() => useEstimates());
        const estimates = result.current.getEstimatesByProject('proj-1');

        expect(mockGetEstimatesByProject).toHaveBeenCalledWith('proj-1');
        expect(estimates).toEqual(mockEstimates);
    });
});
