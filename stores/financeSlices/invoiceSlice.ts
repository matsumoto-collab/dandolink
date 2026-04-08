import { Invoice, InvoiceInput } from '@/types/invoice';
import { logger } from '@/lib/logger';
import { FinanceSlice, FinanceState, FinanceActions } from './types';

function parseInvoiceDates(invoice: Record<string, unknown>): Invoice {
    const projectMasters = invoice.projectMasters as Array<{ id: string; title: string }> | undefined;
    const projectMasterIds = invoice.projectMasterIds as string[] | undefined;
    return {
        ...invoice,
        projectId: (invoice.projectMasterId as string) || (invoice.projectId as string) || '',
        customerId: (invoice.customerId as string) || undefined,
        projectMasters: projectMasters || [],
        projectMasterIds: projectMasterIds || [],
        dueDate: new Date(invoice.dueDate as string),
        paidDate: invoice.paidDate ? new Date(invoice.paidDate as string) : undefined,
        createdAt: new Date(invoice.createdAt as string),
        updatedAt: new Date(invoice.updatedAt as string),
    } as Invoice;
}

function toInvoiceApiPayload(data: Partial<InvoiceInput>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { projectId, projectMasterIds, projectMasters, ...rest } = data;
    return {
        ...rest,
        projectMasterIds: projectMasterIds && projectMasterIds.length > 0 ? projectMasterIds : (projectId ? [projectId] : []),
    };
}

type InvoiceSlice = Pick<FinanceState, 'invoices' | 'invoicesLoading' | 'invoicesInitialized'> &
    Pick<FinanceActions, 'fetchInvoices' | 'addInvoice' | 'updateInvoice' | 'deleteInvoice' | 'getInvoice' | 'getInvoicesByProject'>;

export const createInvoiceSlice: FinanceSlice<InvoiceSlice> = (set, get) => ({
    invoices: [],
    invoicesLoading: false,
    invoicesInitialized: false,

    fetchInvoices: async () => {
        if (get().invoicesLoading) return;

        set({ invoicesLoading: true });
        try {
            const response = await fetch('/api/invoices');
            if (response.ok) {
                const data = await response.json();
                set({
                    invoices: data.map(parseInvoiceDates),
                    invoicesInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch invoices:', error);
        } finally {
            set({ invoicesLoading: false });
        }
    },

    addInvoice: async (data: InvoiceInput) => {
        const response = await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toInvoiceApiPayload(data)),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '請求書の追加に失敗しました');
        }

        const newInvoice = await response.json();
        const parsed = parseInvoiceDates(newInvoice);
        set((state) => ({
            invoices: [...state.invoices, parsed],
        }));
        return parsed;
    },

    updateInvoice: async (id: string, data: Partial<InvoiceInput>) => {
        const response = await fetch(`/api/invoices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toInvoiceApiPayload(data)),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '請求書の更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            invoices: state.invoices.map((i) => (i.id === id ? parseInvoiceDates(updated) : i)),
        }));
    },

    deleteInvoice: async (id: string) => {
        const response = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '請求書の削除に失敗しました');
        }

        set((state) => ({
            invoices: state.invoices.filter((i) => i.id !== id),
        }));
    },

    getInvoice: (id: string) => get().invoices.find((i) => i.id === id),

    getInvoicesByProject: (projectId: string) =>
        get().invoices.filter((i) => i.projectId === projectId),
});
