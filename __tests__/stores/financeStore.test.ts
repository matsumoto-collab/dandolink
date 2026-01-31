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

    describe('Customers', () => {
        const mockCustomer = {
            id: 'c1',
            name: 'Customer 1',
            shortName: 'C1',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z'
        };

        it('fetchCustomers: should fetch and set customers', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockCustomer],
            });

            await act(async () => {
                await useFinanceStore.getState().fetchCustomers();
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(1);
            expect(state.customers[0].createdAt).toBeInstanceOf(Date);
        });

        it('addCustomer: should add customer', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockCustomer,
            });

            await act(async () => {
                await useFinanceStore.getState().addCustomer({ name: 'Customer 1' } as any);
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(1);
            expect(global.fetch).toHaveBeenCalledWith('/api/customers', expect.objectContaining({
                method: 'POST'
            }));
        });

        it('updateCustomer: should update customer', async () => {
            useFinanceStore.setState({
                customers: [{ ...mockCustomer, createdAt: new Date(mockCustomer.createdAt), updatedAt: new Date(mockCustomer.updatedAt) }]
            } as any);

            const updatedCustomer = { ...mockCustomer, name: 'Updated Customer' };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedCustomer,
            });

            await act(async () => {
                await useFinanceStore.getState().updateCustomer('c1', { name: 'Updated Customer' });
            });

            const state = useFinanceStore.getState();
            expect(state.customers[0].name).toBe('Updated Customer');
            expect(global.fetch).toHaveBeenCalledWith('/api/customers/c1', expect.objectContaining({
                method: 'PATCH'
            }));
        });

        it('deleteCustomer: should remove customer', async () => {
            useFinanceStore.setState({
                customers: [{ ...mockCustomer, createdAt: new Date(mockCustomer.createdAt), updatedAt: new Date(mockCustomer.updatedAt) }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useFinanceStore.getState().deleteCustomer('c1');
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(0);
        });
    });

    describe('Estimates', () => {
        const mockEstimate = {
            id: 'e1',
            estimateNumber: 'EST-1',
            projectId: 'p1',
            validUntil: '2023-01-31T00:00:00.000Z',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z'
        };

        it('fetchEstimates: should fetch and set estimates', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockEstimate],
            });

            await act(async () => {
                await useFinanceStore.getState().fetchEstimates();
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(1);
            expect(state.estimates[0].validUntil).toBeInstanceOf(Date);
        });

        it('addEstimate: should add estimate', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockEstimate,
            });

            await act(async () => {
                await useFinanceStore.getState().addEstimate({} as any);
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(1);
        });

        it('updateEstimate: should update estimate', async () => {
            useFinanceStore.setState({
                estimates: [{ ...mockEstimate, validUntil: new Date(mockEstimate.validUntil), createdAt: new Date(mockEstimate.createdAt), updatedAt: new Date(mockEstimate.updatedAt) }]
            } as any);

            const updatedEstimate = { ...mockEstimate, estimateNumber: 'EST-UPDATED' };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedEstimate,
            });

            await act(async () => {
                await useFinanceStore.getState().updateEstimate('e1', { estimateNumber: 'EST-UPDATED' });
            });

            const state = useFinanceStore.getState();
            expect(state.estimates[0].estimateNumber).toBe('EST-UPDATED');
        });

        it('deleteEstimate: should remove estimate', async () => {
            useFinanceStore.setState({
                estimates: [{ ...mockEstimate, validUntil: new Date(mockEstimate.validUntil), createdAt: new Date(mockEstimate.createdAt), updatedAt: new Date(mockEstimate.updatedAt) }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useFinanceStore.getState().deleteEstimate('e1');
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(0);
        });

        it('getEstimatesByProject: should filter estimates', () => {
            useFinanceStore.setState({
                estimates: [
                    { ...mockEstimate, projectId: 'p1', validUntil: new Date(mockEstimate.validUntil), createdAt: new Date(mockEstimate.createdAt), updatedAt: new Date(mockEstimate.updatedAt) },
                    { ...mockEstimate, id: 'e2', projectId: 'p2', validUntil: new Date(mockEstimate.validUntil), createdAt: new Date(mockEstimate.createdAt), updatedAt: new Date(mockEstimate.updatedAt) }
                ]
            } as any);

            const results = useFinanceStore.getState().getEstimatesByProject('p1');
            expect(results).toHaveLength(1);
            expect(results[0].projectId).toBe('p1');
        });
    });

    describe('Invoices', () => {
        const mockInvoice = {
            id: 'inv1',
            invoiceNumber: 'INV-1',
            projectId: 'p1',
            status: 'draft',
            dueDate: '2023-01-31T00:00:00.000Z',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z'
        };

        it('fetchInvoices: should fetch and set invoices', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockInvoice],
            });

            await act(async () => {
                await useFinanceStore.getState().fetchInvoices();
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(1);
            expect(state.invoices[0].dueDate).toBeInstanceOf(Date);
        });

        it('addInvoice: should add invoice', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockInvoice,
            });

            await act(async () => {
                await useFinanceStore.getState().addInvoice({} as any);
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(1);
        });

        it('updateInvoice: should update invoice', async () => {
            useFinanceStore.setState({
                invoices: [{ ...mockInvoice, dueDate: new Date(mockInvoice.dueDate), createdAt: new Date(mockInvoice.createdAt), updatedAt: new Date(mockInvoice.updatedAt) }]
            } as any);

            const updatedInvoice = { ...mockInvoice, status: 'sent' };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedInvoice,
            });

            await act(async () => {
                await useFinanceStore.getState().updateInvoice('inv1', { status: 'sent' });
            });

            const state = useFinanceStore.getState();
            expect(state.invoices[0].status).toBe('sent');
        });

        it('deleteInvoice: should remove invoice', async () => {
            useFinanceStore.setState({
                invoices: [{ ...mockInvoice, dueDate: new Date(mockInvoice.dueDate), createdAt: new Date(mockInvoice.createdAt), updatedAt: new Date(mockInvoice.updatedAt) }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useFinanceStore.getState().deleteInvoice('inv1');
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(0);
        });

        it('getInvoicesByProject: should filter invoices', () => {
            useFinanceStore.setState({
                invoices: [
                    { ...mockInvoice, projectId: 'p1', dueDate: new Date(mockInvoice.dueDate), createdAt: new Date(mockInvoice.createdAt), updatedAt: new Date(mockInvoice.updatedAt) },
                    { ...mockInvoice, id: 'inv2', projectId: 'p2', dueDate: new Date(mockInvoice.dueDate), createdAt: new Date(mockInvoice.createdAt), updatedAt: new Date(mockInvoice.updatedAt) }
                ]
            } as any);

            const results = useFinanceStore.getState().getInvoicesByProject('p1');
            expect(results).toHaveLength(1);
            expect(results[0].projectId).toBe('p1');
        });
    });

    describe('Unit Prices', () => {
        const mockUnitPrice = {
            id: 'up1',
            description: 'Item 1',
            unit: '式',
            unitPrice: 1000,
            templates: ['frequent'],
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z'
        };

        it('fetchUnitPrices: should fetch and set unit prices', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => [mockUnitPrice],
            });

            await act(async () => {
                await useFinanceStore.getState().fetchUnitPrices();
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices).toHaveLength(1);
        });

        it('addUnitPrice: should add unit price', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockUnitPrice,
            });

            await act(async () => {
                await useFinanceStore.getState().addUnitPrice({} as any);
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices).toHaveLength(1);
        });

        it('updateUnitPrice: should update unit price', async () => {
            useFinanceStore.setState({
                unitPrices: [{ ...mockUnitPrice, createdAt: new Date(mockUnitPrice.createdAt), updatedAt: new Date(mockUnitPrice.updatedAt) }]
            } as any);

            const updatedUnitPrice = { ...mockUnitPrice, unitPrice: 2000 };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedUnitPrice,
            });

            await act(async () => {
                await useFinanceStore.getState().updateUnitPrice('up1', { unitPrice: 2000 });
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices[0].unitPrice).toBe(2000);
        });

        it('deleteUnitPrice: should remove unit price', async () => {
            useFinanceStore.setState({
                unitPrices: [{ ...mockUnitPrice, createdAt: new Date(mockUnitPrice.createdAt), updatedAt: new Date(mockUnitPrice.updatedAt) }]
            } as any);

            (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

            await act(async () => {
                await useFinanceStore.getState().deleteUnitPrice('up1');
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices).toHaveLength(0);
        });

        it('getUnitPricesByTemplate: should filter unit prices', () => {
            useFinanceStore.setState({
                unitPrices: [
                    { ...mockUnitPrice, templates: ['frequent'], createdAt: new Date(mockUnitPrice.createdAt), updatedAt: new Date(mockUnitPrice.updatedAt) },
                    { ...mockUnitPrice, id: 'up2', templates: ['large'], createdAt: new Date(mockUnitPrice.createdAt), updatedAt: new Date(mockUnitPrice.updatedAt) }
                ]
            } as any);

            const results = useFinanceStore.getState().getUnitPricesByTemplate('frequent');
            expect(results).toHaveLength(1);
        });
    });
});
