import { renderHook, act } from '@testing-library/react';
import { useInvoices } from '@/hooks/useInvoices';
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

describe('useInvoices', () => {
    // Store mock functions
    const mockFetchInvoices = jest.fn();
    const mockAddInvoice = jest.fn();
    const mockUpdateInvoice = jest.fn();
    const mockDeleteInvoice = jest.fn();
    const mockGetInvoice = jest.fn();
    const mockGetInvoicesByProject = jest.fn();

    // Default store state
    const defaultStoreState = {
        invoices: [],
        invoicesLoading: false,
        invoicesInitialized: false,
        fetchInvoices: mockFetchInvoices,
        addInvoice: mockAddInvoice,
        updateInvoice: mockUpdateInvoice,
        deleteInvoice: mockDeleteInvoice,
        getInvoice: mockGetInvoice,
        getInvoicesByProject: mockGetInvoicesByProject,
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
        const { result } = renderHook(() => useInvoices());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(result.current.invoices).toEqual([]);
    });

    it('should return isInitialized true when store is initialized', () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, invoicesInitialized: true });
        });

        const { result } = renderHook(() => useInvoices());
        expect(result.current.isInitialized).toBe(true);
    });

    it('should call fetchInvoices when ensureDataLoaded is called and not initialized', async () => {
        const { result } = renderHook(() => useInvoices());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchInvoices).toHaveBeenCalledTimes(1);
    });

    it('should not call fetchInvoices when already initialized', async () => {
        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, invoicesInitialized: true });
        });

        const { result } = renderHook(() => useInvoices());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchInvoices).not.toHaveBeenCalled();
    });

    it('should not call fetchInvoices when not authenticated', async () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        const { result } = renderHook(() => useInvoices());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchInvoices).not.toHaveBeenCalled();
    });

    it('should call addInvoice with correct data and return result', async () => {
        const newInvoice = { id: 'new-1', title: 'New Invoice' };
        mockAddInvoice.mockResolvedValue(newInvoice);

        const { result } = renderHook(() => useInvoices());
        const invoiceData = { title: 'New Invoice', projectId: 'proj-1' };

        let returnedInvoice;
        await act(async () => {
            returnedInvoice = await result.current.addInvoice(invoiceData as any);
        });

        expect(mockAddInvoice).toHaveBeenCalledWith(invoiceData);
        expect(returnedInvoice).toEqual(newInvoice);
    });

    it('should call updateInvoice with correct id and data', async () => {
        const { result } = renderHook(() => useInvoices());
        const updateData = { title: 'Updated Invoice' };

        await act(async () => {
            await result.current.updateInvoice('invoice-1', updateData);
        });

        expect(mockUpdateInvoice).toHaveBeenCalledWith('invoice-1', updateData);
    });

    it('should call deleteInvoice with correct id', async () => {
        const { result } = renderHook(() => useInvoices());

        await act(async () => {
            await result.current.deleteInvoice('invoice-1');
        });

        expect(mockDeleteInvoice).toHaveBeenCalledWith('invoice-1');
    });

    it('should call refreshInvoices and trigger fetch', async () => {
        const { result } = renderHook(() => useInvoices());

        await act(async () => {
            await result.current.refreshInvoices();
        });

        expect(mockFetchInvoices).toHaveBeenCalled();
    });

    it('should return invoices from store', () => {
        const mockInvoices = [
            { id: '1', title: 'Invoice 1' },
            { id: '2', title: 'Invoice 2' },
        ];

        (useFinanceStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, invoices: mockInvoices });
        });

        const { result } = renderHook(() => useInvoices());
        expect(result.current.invoices).toEqual(mockInvoices);
    });

    it('should expose getInvoice from store', () => {
        const mockInvoice = { id: '1', title: 'Invoice 1' };
        mockGetInvoice.mockReturnValue(mockInvoice);

        const { result } = renderHook(() => useInvoices());
        const invoice = result.current.getInvoice('1');

        expect(invoice).toEqual(mockInvoice);
    });

    it('should expose getInvoicesByProject from store', () => {
        const mockInvoices = [{ id: '1', title: 'Invoice 1', projectId: 'proj-1' }];
        mockGetInvoicesByProject.mockReturnValue(mockInvoices);

        const { result } = renderHook(() => useInvoices());
        const invoices = result.current.getInvoicesByProject('proj-1');

        expect(mockGetInvoicesByProject).toHaveBeenCalledWith('proj-1');
        expect(invoices).toEqual(mockInvoices);
    });
});
