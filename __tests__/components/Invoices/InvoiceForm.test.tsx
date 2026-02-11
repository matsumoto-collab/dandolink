import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InvoiceForm from '@/components/Invoices/InvoiceForm';
import { useProjects } from '@/hooks/useProjects';
import { useEstimates } from '@/hooks/useEstimates';
import toast from 'react-hot-toast';

// Mocks
jest.mock('@/hooks/useProjects');
jest.mock('@/hooks/useEstimates');

jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        error: jest.fn(),
        success: jest.fn(),
    },
}));

jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="plus-icon" />,
    Trash2: () => <span data-testid="trash-icon" />,
}));

describe('InvoiceForm', () => {
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    // Mock Data
    const mockProjects = [
        { id: 'p1', title: 'Project A' }
    ];
    const mockEstimates = [
        {
            id: 'e1',
            estimateNumber: 'EST-1',
            title: 'Estimate A',
            projectId: 'p1',
            items: [{ id: 'i1', description: 'Item 1', quantity: 2, unitPrice: 100, amount: 200, taxType: 'standard' }],
            notes: 'Note from estimate'
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useProjects as jest.Mock).mockReturnValue({ projects: mockProjects });
        (useEstimates as jest.Mock).mockReturnValue({ estimates: mockEstimates });
    });

    it('renders form with default values', () => {
        render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        expect(screen.getByText('請求番号')).toBeInTheDocument();
        expect(screen.getByText('案件')).toBeInTheDocument();
        expect(screen.getByDisplayValue(/INV-/)).toBeInTheDocument();
        expect(screen.getByText('小計:')).toBeInTheDocument();
        expect(screen.getByText('合計:')).toBeInTheDocument();
    });

    it('validates required fields', async () => {
        const { container } = render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        const form = container.querySelector('form');
        expect(form).toBeInTheDocument();

        // Use fireEvent.submit to bypass HTML5 validation and trigger onSubmit handler directly
        fireEvent.submit(form!);

        // Match regex to avoid encoding issues
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/必須です/));
        expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('calculates totals correctly when items are added and modified', () => {
        render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        // Add item
        fireEvent.click(screen.getByText('行追加'));

        const quantities = document.querySelectorAll('input[type="number"][step="0.1"]');
        const prices = document.querySelectorAll('input[type="number"][min="0"]:not([step="0.1"])');

        // Set values for first item
        fireEvent.change(quantities[0], { target: { value: '2' } });
        fireEvent.change(prices[0], { target: { value: '1000' } });

        // Set values for second item
        fireEvent.change(quantities[1], { target: { value: '1' } });
        fireEvent.change(prices[1], { target: { value: '500' } });

        // Check calculation
        // Subtotal = 2000 + 500 = 2500
        // Tax = 250
        // Total = 2750

        expect(screen.getByText('¥2,500')).toBeInTheDocument();
        expect(screen.getByText('¥250')).toBeInTheDocument();
        expect(screen.getByText('¥2,750')).toBeInTheDocument();
    });

    it('loads data from estimate', () => {
        render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        // Use getAllByRole to select specific combobox
        const selects = screen.getAllByRole('combobox');
        const estimateSelector = selects[0];

        fireEvent.change(estimateSelector, { target: { value: 'e1' } });

        // Should populate fields
        expect(screen.getByDisplayValue('Estimate A')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Item 1')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Note from estimate')).toBeInTheDocument();
    });

    it('submits valid data', () => {
        render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        // Fill required
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[1], { target: { value: 'p1' } }); // Project

        const inputs = screen.getAllByRole('textbox');
        fireEvent.change(inputs[1], { target: { value: 'Invoice Title' } }); // Title

        // Submit
        fireEvent.click(screen.getByText('保存'));

        expect(mockOnSubmit).toHaveBeenCalledWith(expect.objectContaining({
            projectId: 'p1',
            title: 'Invoice Title',
        }));
    });

    it('shows paid date input only when status is paid', () => {
        render(<InvoiceForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        const statusSelect = screen.getAllByRole('combobox')[2]; // Status

        expect(screen.queryByText('支払日')).not.toBeInTheDocument();

        fireEvent.change(statusSelect, { target: { value: 'paid' } });

        expect(screen.getByText('支払日')).toBeInTheDocument();
    });
});
