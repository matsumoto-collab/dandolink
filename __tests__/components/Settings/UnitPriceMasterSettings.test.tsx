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
    Settings: () => <span data-testid="icon-settings" />,
}));

const mockTemplates = [
    { id: 'tpl-frequent', name: 'よく使う項目', sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'tpl-large', name: '大規模見積用', sortOrder: 1, isActive: true, createdAt: new Date(), updatedAt: new Date() },
];

const mockCategories = [
    { id: 'cat1', name: '足場工事', sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() },
];

describe('UnitPriceMasterSettings', () => {
    const mockEnsureDataLoaded = jest.fn();
    const mockAddUnitPrice = jest.fn();
    const mockUpdateUnitPrice = jest.fn();
    const mockDeleteUnitPrice = jest.fn();
    const mockAddUnitPriceTemplate = jest.fn();
    const mockUpdateUnitPriceTemplate = jest.fn();
    const mockDeleteUnitPriceTemplate = jest.fn();
    const mockAddUnitPriceCategory = jest.fn();
    const mockUpdateUnitPriceCategory = jest.fn();
    const mockDeleteUnitPriceCategory = jest.fn();
    const mockAddUnitPriceSpecification = jest.fn();
    const mockUpdateUnitPriceSpecification = jest.fn();
    const mockDeleteUnitPriceSpecification = jest.fn();

    const mockUnitPrices = [
        {
            id: 'up1',
            description: 'Item 1',
            unit: 'm',
            unitPrice: 1000,
            templates: ['tpl-frequent'],
            categoryId: 'cat1',
            notes: 'Note 1',
        },
        {
            id: 'up2',
            description: 'Item 2',
            unit: 'ps',
            unitPrice: 2000,
            templates: ['tpl-large'],
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
            unitPriceTemplates: mockTemplates,
            addUnitPriceTemplate: mockAddUnitPriceTemplate,
            updateUnitPriceTemplate: mockUpdateUnitPriceTemplate,
            deleteUnitPriceTemplate: mockDeleteUnitPriceTemplate,
            unitPriceCategories: mockCategories,
            addUnitPriceCategory: mockAddUnitPriceCategory,
            updateUnitPriceCategory: mockUpdateUnitPriceCategory,
            deleteUnitPriceCategory: mockDeleteUnitPriceCategory,
            unitPriceSpecifications: [],
            addUnitPriceSpecification: mockAddUnitPriceSpecification,
            updateUnitPriceSpecification: mockUpdateUnitPriceSpecification,
            deleteUnitPriceSpecification: mockDeleteUnitPriceSpecification,
        });
    });

    it('should render sub-tabs', () => {
        render(<UnitPriceMasterSettings />);
        expect(screen.getByText('単価項目')).toBeInTheDocument();
        expect(screen.getByText('テンプレート')).toBeInTheDocument();
        expect(screen.getByText('カテゴリ')).toBeInTheDocument();
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

        const filterSelects = screen.getAllByRole('combobox');
        // First combobox is template filter
        fireEvent.change(filterSelects[0], { target: { value: 'tpl-frequent' } });

        expect(screen.getByText('Item 1')).toBeInTheDocument();
        expect(screen.queryByText('Item 2')).not.toBeInTheDocument();
    });

    it('should open create modal and add new item', async () => {
        render(<UnitPriceMasterSettings />);

        fireEvent.click(screen.getByText('新規登録'));

        expect(screen.getByText('単価マスター登録')).toBeInTheDocument();

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

        fireEvent.change(screen.getByRole('textbox', { name: /品目・内容/ }), { target: { value: 'Updated Item' } });
        fireEvent.click(screen.getByText('保存'));

        expect(mockUpdateUnitPrice).toHaveBeenCalledWith('up1', expect.objectContaining({
            description: 'Updated Item',
        }));
    });

    it('should delete item after confirmation', async () => {
        window.confirm = jest.fn(() => true);

        render(<UnitPriceMasterSettings />);

        const deleteButtons = screen.getAllByTestId('icon-trash');
        fireEvent.click(deleteButtons[0]); // Delete Item 1

        expect(window.confirm).toHaveBeenCalledWith('「Item 1」を削除してもよろしいですか？');
        expect(mockDeleteUnitPrice).toHaveBeenCalledWith('up1');
    });

    it('should handle template toggling in form', async () => {
        render(<UnitPriceMasterSettings />);
        fireEvent.click(screen.getByText('新規登録'));

        const checkbox = screen.getByLabelText('よく使う項目');
        fireEvent.click(checkbox);

        expect(checkbox).toBeChecked();
    });

    it('should switch to templates tab', () => {
        render(<UnitPriceMasterSettings />);
        fireEvent.click(screen.getByText('テンプレート'));

        expect(screen.getByText('テンプレート管理')).toBeInTheDocument();
        expect(screen.getByText('よく使う項目')).toBeInTheDocument();
        expect(screen.getByText('大規模見積用')).toBeInTheDocument();
    });

    it('should switch to categories tab', () => {
        render(<UnitPriceMasterSettings />);
        fireEvent.click(screen.getByText('カテゴリ'));

        expect(screen.getByText('カテゴリ管理')).toBeInTheDocument();
        expect(screen.getByText('足場工事')).toBeInTheDocument();
    });
});
