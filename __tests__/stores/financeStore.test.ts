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

    describe('Company', () => {
        const mockCompany = {
            name: 'Test Company',
            createdAt: '2023-01-01T00:00:00.000Z',
            updatedAt: '2023-01-01T00:00:00.000Z',
        };

        it('fetchCompanyInfo: 正常に取得できる', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => mockCompany,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchCompanyInfo();
            });

            const state = useFinanceStore.getState();
            expect(state.companyInfo).not.toBeNull();
            expect(state.companyInfo?.name).toBe('Test Company');
            expect(state.companyInitialized).toBe(true);
        });

        it('fetchCompanyInfo: fetchがエラーの場合、companyInfoはnullのまま', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                await useFinanceStore.getState().fetchCompanyInfo();
            });

            const state = useFinanceStore.getState();
            expect(state.companyInfo).toBeNull();
            expect(state.companyLoading).toBe(false);
        });

        it('fetchCompanyInfo: レスポンスが失敗の場合、companyInfoはnullのまま', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchCompanyInfo();
            });

            const state = useFinanceStore.getState();
            expect(state.companyInfo).toBeNull();
            expect(state.companyLoading).toBe(false);
        });

        it('fetchCompanyInfo: ローディング中は二重呼び出しされない', async () => {
            useFinanceStore.setState({ companyLoading: true } as any);

            await act(async () => {
                await useFinanceStore.getState().fetchCompanyInfo();
            });

            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('updateCompanyInfo: 正常に更新できる', async () => {
            const updatedCompany = {
                name: 'Updated Company',
                createdAt: '2023-01-01T00:00:00.000Z',
                updatedAt: '2023-06-01T00:00:00.000Z',
            };
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => updatedCompany,
            });

            await act(async () => {
                await useFinanceStore.getState().updateCompanyInfo({ name: 'Updated Company' } as any);
            });

            expect(useFinanceStore.getState().companyInfo?.name).toBe('Updated Company');
        });

        it('updateCompanyInfo: APIエラー時は更新されない', async () => {
            useFinanceStore.setState({ companyInfo: { name: 'Original' } } as any);

            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'Error' }),
            });

            await act(async () => {
                await useFinanceStore.getState().updateCompanyInfo({ name: 'New' } as any);
            });

            expect(useFinanceStore.getState().companyInfo?.name).toBe('Original');
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

        it('fetchCustomers: fetchがエラーの場合、customersは空のまま', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                await useFinanceStore.getState().fetchCustomers();
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(0);
            expect(state.customersLoading).toBe(false);
        });

        it('fetchCustomers: レスポンスが失敗の場合、customersは空のまま', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchCustomers();
            });

            const state = useFinanceStore.getState();
            expect(state.customers).toHaveLength(0);
            expect(state.customersLoading).toBe(false);
        });

        it('fetchCustomers: ローディング中は二重呼び出しされない', async () => {
            useFinanceStore.setState({ customersLoading: true } as any);

            await act(async () => {
                await useFinanceStore.getState().fetchCustomers();
            });

            expect(global.fetch).not.toHaveBeenCalled();
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

        it('addCustomer: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '追加に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().addCustomer({ name: 'Test' } as any);
                })
            ).rejects.toThrow();
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

        it('updateCustomer: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '更新に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().updateCustomer('c1', { name: 'Updated' });
                })
            ).rejects.toThrow();
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

        it('deleteCustomer: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '削除に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().deleteCustomer('c1');
                })
            ).rejects.toThrow();
        });

        it('getCustomerById: 存在するIDを返す', () => {
            useFinanceStore.setState({ customers: [{ id: 'c1', name: 'Cust' } as any] });
            expect(useFinanceStore.getState().getCustomerById('c1')?.name).toBe('Cust');
        });

        it('getCustomerById: 存在しないIDはundefined', () => {
            expect(useFinanceStore.getState().getCustomerById('non-existent')).toBeUndefined();
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

        it('fetchEstimates: fetchがエラーの場合、estimatesは空のまま', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                await useFinanceStore.getState().fetchEstimates();
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(0);
            expect(state.estimatesLoading).toBe(false);
        });

        it('fetchEstimates: レスポンスが失敗の場合、estimatesは空のまま', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchEstimates();
            });

            const state = useFinanceStore.getState();
            expect(state.estimates).toHaveLength(0);
            expect(state.estimatesLoading).toBe(false);
        });

        it('fetchEstimates: ローディング中は二重呼び出しされない', async () => {
            useFinanceStore.setState({ estimatesLoading: true } as any);

            await act(async () => {
                await useFinanceStore.getState().fetchEstimates();
            });

            expect(global.fetch).not.toHaveBeenCalled();
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

        it('addEstimate: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '追加に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().addEstimate({} as any);
                })
            ).rejects.toThrow();
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

        it('updateEstimate: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '更新に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().updateEstimate('e1', {});
                })
            ).rejects.toThrow();
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

        it('deleteEstimate: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '削除に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().deleteEstimate('e1');
                })
            ).rejects.toThrow();
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

        it('fetchInvoices: fetchがエラーの場合、invoicesは空のまま', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                await useFinanceStore.getState().fetchInvoices();
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(0);
            expect(state.invoicesLoading).toBe(false);
        });

        it('fetchInvoices: レスポンスが失敗の場合、invoicesは空のまま', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchInvoices();
            });

            const state = useFinanceStore.getState();
            expect(state.invoices).toHaveLength(0);
            expect(state.invoicesLoading).toBe(false);
        });

        it('fetchInvoices: ローディング中は二重呼び出しされない', async () => {
            useFinanceStore.setState({ invoicesLoading: true } as any);

            await act(async () => {
                await useFinanceStore.getState().fetchInvoices();
            });

            expect(global.fetch).not.toHaveBeenCalled();
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

        it('addInvoice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '追加に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().addInvoice({} as any);
                })
            ).rejects.toThrow();
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

        it('updateInvoice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '更新に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().updateInvoice('inv1', {});
                })
            ).rejects.toThrow();
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

        it('deleteInvoice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '削除に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().deleteInvoice('inv1');
                })
            ).rejects.toThrow();
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

        it('fetchUnitPrices: fetchがエラーの場合、unitPricesは空のまま', async () => {
            (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

            await act(async () => {
                await useFinanceStore.getState().fetchUnitPrices();
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices).toHaveLength(0);
            expect(state.unitPricesLoading).toBe(false);
        });

        it('fetchUnitPrices: レスポンスが失敗の場合、unitPricesは空のまま', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 500,
            });

            await act(async () => {
                await useFinanceStore.getState().fetchUnitPrices();
            });

            const state = useFinanceStore.getState();
            expect(state.unitPrices).toHaveLength(0);
            expect(state.unitPricesLoading).toBe(false);
        });

        it('fetchUnitPrices: ローディング中は二重呼び出しされない', async () => {
            useFinanceStore.setState({ unitPricesLoading: true } as any);

            await act(async () => {
                await useFinanceStore.getState().fetchUnitPrices();
            });

            expect(global.fetch).not.toHaveBeenCalled();
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

        it('addUnitPrice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '追加に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().addUnitPrice({} as any);
                })
            ).rejects.toThrow();
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

        it('updateUnitPrice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '更新に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().updateUnitPrice('up1', {});
                })
            ).rejects.toThrow();
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

        it('deleteUnitPrice: APIエラー時にthrowする', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                json: async () => ({ error: '削除に失敗' }),
            });

            await expect(
                act(async () => {
                    await useFinanceStore.getState().deleteUnitPrice('up1');
                })
            ).rejects.toThrow();
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

    describe('Getters', () => {
        it('getEstimate: should return correct estimate', () => {
            useFinanceStore.setState({ estimates: [{ id: 'e1', estimateNumber: '1' } as any] });
            expect(useFinanceStore.getState().getEstimate('e1')?.estimateNumber).toBe('1');
            expect(useFinanceStore.getState().getEstimate('non-existent')).toBeUndefined();
        });

        it('getInvoice: should return correct invoice', () => {
            useFinanceStore.setState({ invoices: [{ id: 'i1', invoiceNumber: '1' } as any] });
            expect(useFinanceStore.getState().getInvoice('i1')?.invoiceNumber).toBe('1');
            expect(useFinanceStore.getState().getInvoice('non-existent')).toBeUndefined();
        });

        it('getUnitPriceById: should return correct unit price', () => {
            useFinanceStore.setState({ unitPrices: [{ id: 'u1', description: 'desc' } as any] });
            expect(useFinanceStore.getState().getUnitPriceById('u1')?.description).toBe('desc');
            expect(useFinanceStore.getState().getUnitPriceById('non-existent')).toBeUndefined();
        });
    });

    describe('Selectors', () => {
        it('should select various state slices', async () => {
            const state = {
                companyInfo: { name: 'Comp' },
                companyLoading: true,
                companyInitialized: true,
                customers: [{ id: 'c1' }],
                customersLoading: false,
                customersInitialized: true,
                estimates: [{ id: 'e1' }],
                estimatesLoading: true,
                estimatesInitialized: false,
                invoices: [{ id: 'i1' }],
                invoicesLoading: false,
                invoicesInitialized: true,
                unitPrices: [{ id: 'u1' }],
                unitPricesLoading: true,
                unitPricesInitialized: false
            } as any;

            // Import selectors dynamically or mock
            const {
                selectCompanyInfo, selectCompanyLoading, selectCompanyInitialized,
                selectCustomers, selectCustomersLoading, selectCustomersInitialized,
                selectEstimates, selectEstimatesLoading, selectEstimatesInitialized,
                selectInvoices, selectInvoicesLoading, selectInvoicesInitialized,
                selectUnitPrices, selectUnitPricesLoading, selectUnitPricesInitialized
            } = await import('@/stores/financeStore');

            expect(selectCompanyInfo({ ...useFinanceStore.getState(), ...state })).toEqual({ name: 'Comp' });
            expect(selectCompanyLoading({ ...useFinanceStore.getState(), ...state })).toBe(true);
            expect(selectCompanyInitialized({ ...useFinanceStore.getState(), ...state })).toBe(true);

            expect(selectCustomers({ ...useFinanceStore.getState(), ...state })).toHaveLength(1);
            expect(selectCustomersLoading({ ...useFinanceStore.getState(), ...state })).toBe(false);
            expect(selectCustomersInitialized({ ...useFinanceStore.getState(), ...state })).toBe(true);

            expect(selectEstimates({ ...useFinanceStore.getState(), ...state })).toHaveLength(1);
            expect(selectEstimatesLoading({ ...useFinanceStore.getState(), ...state })).toBe(true);
            expect(selectEstimatesInitialized({ ...useFinanceStore.getState(), ...state })).toBe(false);

            expect(selectInvoices({ ...useFinanceStore.getState(), ...state })).toHaveLength(1);
            expect(selectInvoicesLoading({ ...useFinanceStore.getState(), ...state })).toBe(false);
            expect(selectInvoicesInitialized({ ...useFinanceStore.getState(), ...state })).toBe(true);

            expect(selectUnitPrices({ ...useFinanceStore.getState(), ...state })).toHaveLength(1);
            expect(selectUnitPricesLoading({ ...useFinanceStore.getState(), ...state })).toBe(true);
            expect(selectUnitPricesInitialized({ ...useFinanceStore.getState(), ...state })).toBe(false);
        });
    });
});
