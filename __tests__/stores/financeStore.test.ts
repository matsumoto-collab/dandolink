import { act } from '@testing-library/react';
import { useFinanceStore } from '@/stores/financeStore';

// Mock global fetch
global.fetch = jest.fn();

describe('financeStore', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        act(() => {
            useFinanceStore.getState().reset();
        });
    });

    describe('fetchCustomers', () => {
        it('should fetch and set customers', async () => {
            const mockData = [
                { id: '1', name: 'Customer 1', createdAt: '2023-01-01', updatedAt: '2023-01-01' },
            ];
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockData,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchCustomers();
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(1);
            expect(state.customers[0].name).toBe('Customer 1');
            expect(state.customers[0].createdAt).toBeInstanceOf(Date);
        });
    });

    describe('fetchEstimates', () => {
        it('should fetch and set estimates', async () => {
            const mockData = [
                {
                    id: 'e1',
                    estimateNumber: 'EST-1',
                    validUntil: '2023-01-31',
                    createdAt: '2023-01-01',
                    updatedAt: '2023-01-01'
                },
            ];
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockData,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchEstimates();
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(1);
            expect(state.estimates[0].estimateNumber).toBe('EST-1');
            expect(state.estimates[0].validUntil).toBeInstanceOf(Date);
        });
    });

    describe('addInvoice', () => {
        it('should add an invoice to the state', async () => {
            const mockInput = {
                projectMasterId: 'pm1',
                invoiceNumber: 'INV-1',
                title: 'Invoice 1',
                items: [],
                subtotal: 1000,
                tax: 100,
                total: 1100,
                dueDate: '2023-01-31'
            };
            const mockResponse = {
                id: 'inv1',
                ...mockInput,
                dueDate: '2023-01-31',
                createdAt: '2023-01-01',
                updatedAt: '2023-01-01'
            };

            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockResponse,
            });

            await act(async () => {
                await useFinanceStore.getState().addInvoice(mockInput as any);
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(1);
            expect(state.invoices[0].invoiceNumber).toBe('INV-1');
        });
    });
});
