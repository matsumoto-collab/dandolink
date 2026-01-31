import { renderHook, act } from '@testing-library/react';
import { useCompany } from '@/hooks/useCompany';
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

describe('useCompany', () => {
    // Store mock functions
    const mockFetchCompanyInfo = jest.fn();
    const mockUpdateCompanyInfo = jest.fn();

    // Default store state
    const defaultStoreState = {
        companyInfo: null,
        companyLoading: false,
        companyInitialized: false,
        fetchCompanyInfo: mockFetchCompanyInfo,
        updateCompanyInfo: mockUpdateCompanyInfo,
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
        const { result } = renderHook(() => useCompany());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.companyInfo).toBeNull();
    });

    it('should return isInitialized true when store is initialized', () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, companyInitialized: true });
        });

        const { result } = renderHook(() => useCompany());
        expect(result.current.isInitialized).toBe(true);
    });

    it('should call fetchCompanyInfo when ensureDataLoaded is called and not initialized', async () => {
        const { result } = renderHook(() => useCompany());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCompanyInfo).toHaveBeenCalledTimes(1);
    });

    it('should not call fetchCompanyInfo when already initialized', async () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, companyInitialized: true });
        });

        const { result } = renderHook(() => useCompany());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCompanyInfo).not.toHaveBeenCalled();
    });

    it('should not call fetchCompanyInfo when not authenticated', async () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        const { result } = renderHook(() => useCompany());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCompanyInfo).not.toHaveBeenCalled();
    });

    it('should call updateCompanyInfo with correct data', async () => {
        const { result } = renderHook(() => useCompany());
        const companyData = { name: 'Test Company', address: '123 Test St' };

        await act(async () => {
            await result.current.updateCompanyInfo(companyData as any);
        });

        expect(mockUpdateCompanyInfo).toHaveBeenCalledWith(companyData);
    });

    it('should call refreshCompanyInfo and trigger fetch', async () => {
        const { result } = renderHook(() => useCompany());

        await act(async () => {
            await result.current.refreshCompanyInfo();
        });

        expect(mockFetchCompanyInfo).toHaveBeenCalled();
    });

    it('should return companyInfo from store', () => {
        const mockCompanyInfo = {
            id: '1',
            name: 'Test Company',
            address: '123 Test St',
            phone: '123-456-7890',
        };

        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, companyInfo: mockCompanyInfo });
        });

        const { result } = renderHook(() => useCompany());
        expect(result.current.companyInfo).toEqual(mockCompanyInfo);
    });
});
