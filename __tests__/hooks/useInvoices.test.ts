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

    it('should create invoice from estimate with correct data', async () => {
        const newInvoice = { id: 'inv-1', title: 'Test Estimate' };
        mockAddInvoice.mockResolvedValue(newInvoice);

        const { result } = renderHook(() => useInvoices());
        const estimate = {
            id: 'est-1',
            projectId: 'proj-1',
            title: 'Test Estimate',
            items: [{ name: 'Item 1', quantity: 1, unitPrice: 1000 }],
            subtotal: 1000,
            tax: 100,
            total: 1100,
            notes: 'Test notes',
        };

        let createdInvoice;
        await act(async () => {
            createdInvoice = await result.current.createInvoiceFromEstimate(estimate as any);
        });

        expect(mockAddInvoice).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'proj-1',
                estimateId: 'est-1',
                title: 'Test Estimate',
                items: estimate.items,
                subtotal: 1000,
                tax: 100,
                total: 1100,
                status: 'draft',
                notes: 'Test notes',
            })
        );
        expect(createdInvoice).toEqual(newInvoice);
    });

    it('should set default values when creating invoice from estimate', async () => {
        mockAddInvoice.mockResolvedValue({ id: 'inv-1' });

        const { result } = renderHook(() => useInvoices());
        const estimate = {
            id: 'est-1',
            title: 'Test',
            items: [],
            subtotal: 0,
            tax: 0,
            total: 0,
        };

        await act(async () => {
            await result.current.createInvoiceFromEstimate(estimate as any);
        });

        expect(mockAddInvoice).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: '', // Default when projectId is undefined
                status: 'draft',
            })
        );

        // Verify dueDate is set to ~30 days from now
        const callArg = mockAddInvoice.mock.calls[0][0];
        const dueDate = new Date(callArg.dueDate);
        const now = new Date();
        const diffDays = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBeGreaterThanOrEqual(29);
        expect(diffDays).toBeLessThanOrEqual(31);
    });
});
