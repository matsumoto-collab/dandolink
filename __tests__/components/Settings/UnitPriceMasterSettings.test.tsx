/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UnitPriceMasterSettings from '@/components/Settings/UnitPriceMasterSettings';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';
import toast from 'react-hot-toast';

// Mock hooks
jest.mock('@/hooks/useUnitPriceMaster');
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
}));

describe('UnitPriceMasterSettings', () => {
    const mockEnsureDataLoaded = jest.fn();
    const mockAddUnitPrice = jest.fn();
    const mockUpdateUnitPrice = jest.fn();
    const mockDeleteUnitPrice = jest.fn();

    const mockUnitPrices = [
        {
            id: 'up1',
            description: 'Item 1',
            unit: 'm',
            unitPrice: 1000,
            templates: ['frequent'],
            notes: 'Note 1',
        },
        {
            id: 'up2',
            description: 'Item 2',
            unit: 'ps',
            unitPrice: 2000,
            templates: ['large'],
            notes: '',
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        (useUnitPriceMaster as jest.Mock).mockReturnValue({
            unitPrices: mockUnitPrices,
            ensureDataLoaded: mockEnsureDataLoaded,
            addUnitPrice: mockAddUnitPrice,
            updateUnitPrice: mockUpdateUnitPrice,
            deleteUnitPrice: mockDeleteUnitPrice,
        });
    });

    it('should render unit price list', () => {
        render(<UnitPriceMasterSettings />);

        expect(mockEnsureDataLoaded).toHaveBeenCalled();
        expect(screen.getByText('Item 1')).toBeInTheDocument();
        expect(screen.getByText('Item 2')).toBeInTheDocument();
        expect(screen.getByText(/¥1,000/)).toBeInTheDocument();
    });

    it('should filter items by template', async () => {
        render(<UnitPriceMasterSettings />);

        const filterSelect = screen.getByRole('combobox');
        fireEvent.change(filterSelect, { target: { value: 'frequent' } });

        // Item 1 (frequent) should be visible
        expect(screen.getByText('Item 1')).toBeInTheDocument();
        // Item 2 (large) should be hidden
        expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
    });

    it('should open create modal and add new item', async () => {
        render(<UnitPriceMasterSettings />);

        fireEvent.click(screen.getByText('新規登録'));

        expect(screen.getByText('単価マスター登録')).toBeInTheDocument();

        // Fill form
        fireEvent.change(screen.getByLabelText(/品目・内容/), { target: { value: 'New Item' } });
        fireEvent.change(screen.getByLabelText(/単位/), { target: { value: 'set' } });
        fireEvent.change(screen.getByLabelText(/単価/), { target: { value: '5000' } });

        fireEvent.click(screen.getByText('保存'));

        expect(mockAddUnitPrice).toHaveBeenCalledWith(expect.objectContaining({
            description: 'New Item',
            unit: 'set',
            unitPrice: 5000,
        }));
    });

    it('should fail validation if required fields are missing', async () => {
        const { container } = render(<UnitPriceMasterSettings />);
        fireEvent.click(screen.getByText('新規登録'));

        // Click save without filling
        const form = container.querySelector('form');
        if (!form) throw new Error('Form not found');

        fireEvent.submit(form);

        expect(toast.error).toHaveBeenCalledWith('品目と単位は必須です');
        expect(mockAddUnitPrice).not.toHaveBeenCalled();
    });

    it('should open edit modal and update item', async () => {
        render(<UnitPriceMasterSettings />);

        const editButtons = screen.getAllByTestId('icon-edit');
        fireEvent.click(editButtons[0]); // Edit Item 1

        expect(screen.getByRole('textbox', { name: /品目・内容/ })).toHaveValue('Item 1');

        // Change value
        fireEvent.change(screen.getByRole('textbox', { name: /品目・内容/ }), { target: { value: 'Updated Item' } });
        fireEvent.click(screen.getByText('保存'));

        expect(mockUpdateUnitPrice).toHaveBeenCalledWith('up1', expect.objectContaining({
            description: 'Updated Item',
        }));
    });

    it('should delete item after confirmation', async () => {
        window.confirm = jest.fn(() => true); // Mock confirm

        render(<UnitPriceMasterSettings />);

        const deleteButtons = screen.getAllByTestId('icon-trash');
        fireEvent.click(deleteButtons[0]); // Delete Item 1

        expect(window.confirm).toHaveBeenCalledWith('「Item 1」を削除してもよろしいですか？');
        expect(mockDeleteUnitPrice).toHaveBeenCalledWith('up1');
    });

    it('should handle template toggling', async () => {
        render(<UnitPriceMasterSettings />);
        fireEvent.click(screen.getByText('新規登録'));

        // Toggle 'frequent' (well-used items)
        const checkbox = screen.getByLabelText('よく使う項目');
        fireEvent.click(checkbox);

        expect(checkbox).toBeChecked();
    });
});
