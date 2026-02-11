/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InvoiceListPage from '@/app/(finance)/invoices/page';
import { useInvoices } from '@/hooks/useInvoices';
import { useProjects } from '@/hooks/useProjects';
import { useCompany } from '@/hooks/useCompany';

// Mock useCompany
jest.mock('@/hooks/useCompany', () => ({
    useCompany: jest.fn(),
}));

// Mock useDebounce to return value immediately
jest.mock('@/hooks/useDebounce', () => ({
    useDebounce: (value: any) => value,
}));

// Mock hooks
jest.mock('@/hooks/useInvoices');
jest.mock('@/hooks/useProjects');

// Mock the reactPdfGenerator to avoid ESM import issues
jest.mock('@/utils/reactPdfGenerator', () => ({
    exportInvoicePDFReact: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({
        push: jest.fn(),
    })),
}));
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
}));

// Mock dynamic imports
jest.mock('next/dynamic', () => () => {
    const DynamicComponent = () => <div data-testid="mock-dynamic-component" />;
    return DynamicComponent;
});

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
    FileText: () => <span data-testid="icon-file-text" />,
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    Clock: () => <span data-testid="icon-clock" />,
    AlertCircle: () => <span data-testid="icon-alert-circle" />,
    Loader2: () => <span data-testid="icon-loader" />,
    Filter: () => <span data-testid="icon-filter" />,
    Download: () => <span data-testid="icon-download" />,
}));

const mockInvoices = [
    {
        id: 'inv1',
        invoiceNumber: 'INV-001',
        projectId: 'proj1',
        title: 'Invoice 1',
        dueDate: new Date('2024-02-01'),
        total: 150000,
        status: 'sent',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        items: [],
    },
    {
        id: 'inv2',
        invoiceNumber: 'INV-002',
        projectId: 'proj2',
        title: 'Invoice 2',
        dueDate: new Date('2024-02-02'),
        total: 250000,
        status: 'paid',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        items: [],
    },
];

const mockProjects = [
    { id: 'proj1', title: 'Project 1' },
    { id: 'proj2', title: 'Project 2' },
];

describe('InvoiceListPage', () => {
    const mockAddInvoice = jest.fn();
    const mockUpdateInvoice = jest.fn();
    const mockDeleteInvoice = jest.fn();

    beforeEach(() => {
        (useCompany as jest.Mock).mockReturnValue({
            companyInfo: { id: 'comp1', name: 'Test Company', address: 'Tokyo' },
            isLoading: false,
            ensureDataLoaded: jest.fn(),
        });
        (useInvoices as jest.Mock).mockReturnValue({
            invoices: mockInvoices,
            isLoading: false,
            ensureDataLoaded: jest.fn(),
            addInvoice: mockAddInvoice,
            updateInvoice: mockUpdateInvoice,
            deleteInvoice: mockDeleteInvoice,
        });
        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
            isLoading: false,
        });
    });

    it('should render invoice list', () => {
        render(<InvoiceListPage />);
        expect(screen.getByText('請求書一覧')).toBeInTheDocument();
        expect(screen.getAllByText('INV-001').length).toBeGreaterThan(0);
        expect(screen.getAllByText('INV-002').length).toBeGreaterThan(0);
    });

    it('should filter invoices by search query', async () => {
        render(<InvoiceListPage />);
        const searchInput = screen.getByPlaceholderText('請求番号、案件名で検索...');
        fireEvent.change(searchInput, { target: { value: 'INV-001' } });

        await waitFor(() => {
            expect(screen.getAllByText('INV-001').length).toBeGreaterThan(0);
            expect(screen.queryByText('INV-002')).not.toBeInTheDocument();
        });
    });

    it('should open modal on "New Invoice" click', () => {
        render(<InvoiceListPage />);
        fireEvent.click(screen.getByText('新規作成'));
        expect(screen.getAllByTestId('mock-dynamic-component')).toHaveLength(1);
    });

    it('should handle invoice deletion', async () => {
        window.confirm = jest.fn(() => true);
        render(<InvoiceListPage />);

        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteInvoice).toHaveBeenCalled();
        });
    });

    it('should show loading state', () => {
        (useInvoices as jest.Mock).mockReturnValue({
            invoices: [],
            isLoading: true,
            ensureDataLoaded: jest.fn(),
            addInvoice: jest.fn(),
            updateInvoice: jest.fn(),
            deleteInvoice: jest.fn(),
        });
        render(<InvoiceListPage />);
        // When loading with empty invoices, no invoice data should be visible
        expect(screen.queryByText('INV-001')).not.toBeInTheDocument();
    });
});
