import { renderHook, act } from '@testing-library/react';
import { useCustomers } from '@/hooks/useCustomers';
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

describe('useCustomers', () => {
    // Store mock functions
    const mockFetchCustomers = jest.fn();
    const mockAddCustomer = jest.fn();
    const mockUpdateCustomer = jest.fn();
    const mockDeleteCustomer = jest.fn();
    const mockGetCustomerById = jest.fn();

    // Default store state
    const defaultStoreState = {
        customers: [],
        customersLoading: false,
        customersInitialized: false,
        fetchCustomers: mockFetchCustomers,
        addCustomer: mockAddCustomer,
        updateCustomer: mockUpdateCustomer,
        deleteCustomer: mockDeleteCustomer,
        getCustomerById: mockGetCustomerById,
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
        const { result } = renderHook(() => useCustomers());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.customers).toEqual([]);
    });

    it('should return isInitialized true when store is initialized', () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, customersInitialized: true });
        });

        const { result } = renderHook(() => useCustomers());
        expect(result.current.isInitialized).toBe(true);
    });

    it('should call fetchCustomers when ensureDataLoaded is called and not initialized', async () => {
        const { result } = renderHook(() => useCustomers());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCustomers).toHaveBeenCalledTimes(1);
    });

    it('should not call fetchCustomers when already initialized', async () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, customersInitialized: true });
        });

        const { result } = renderHook(() => useCustomers());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCustomers).not.toHaveBeenCalled();
    });

    it('should not call fetchCustomers when not authenticated', async () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        const { result } = renderHook(() => useCustomers());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchCustomers).not.toHaveBeenCalled();
    });

    it('should call addCustomer with correct data', async () => {
        const { result } = renderHook(() => useCustomers());
        const customerData = { name: 'Test Customer', email: 'test@example.com' };

        await act(async () => {
            await result.current.addCustomer(customerData as any);
        });

        expect(mockAddCustomer).toHaveBeenCalledWith(customerData);
    });

    it('should call updateCustomer with correct id and data', async () => {
        const { result } = renderHook(() => useCustomers());
        const updateData = { name: 'Updated Customer' };

        await act(async () => {
            await result.current.updateCustomer('customer-1', updateData);
        });

        expect(mockUpdateCustomer).toHaveBeenCalledWith('customer-1', updateData);
    });

    it('should call deleteCustomer with correct id', async () => {
        const { result } = renderHook(() => useCustomers());

        await act(async () => {
            await result.current.deleteCustomer('customer-1');
        });

        expect(mockDeleteCustomer).toHaveBeenCalledWith('customer-1');
    });

    it('should call refreshCustomers and trigger fetch', async () => {
        const { result } = renderHook(() => useCustomers());

        await act(async () => {
            await result.current.refreshCustomers();
        });

        expect(mockFetchCustomers).toHaveBeenCalled();
    });

    it('should return customers from store', () => {
        const mockCustomers = [
            { id: '1', name: 'Customer 1' },
            { id: '2', name: 'Customer 2' },
        ];

        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, customers: mockCustomers });
        });

        const { result } = renderHook(() => useCustomers());
        expect(result.current.customers).toEqual(mockCustomers);
    });

    it('should expose getCustomerById from store', () => {
        const mockCustomer = { id: '1', name: 'Customer 1' };
        mockGetCustomerById.mockReturnValue(mockCustomer);

        const { result } = renderHook(() => useCustomers());
        const customer = result.current.getCustomerById('1');

        expect(customer).toEqual(mockCustomer);
    });
});
