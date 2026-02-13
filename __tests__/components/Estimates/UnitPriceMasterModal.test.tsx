/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UnitPriceMasterModal from '@/components/Estimates/UnitPriceMasterModal';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';

// Mock hooks
jest.mock('@/hooks/useUnitPriceMaster');

// Mock lucide-react
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
}));

const mockItems = [
    {
        id: 'up1',
        description: '足場組立一式',
        unit: '式',
        unitPrice: 50000,
        templates: ['frequent'] as const,
        notes: 'テスト備考',
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: 'up2',
        description: 'メッシュシート',
        unit: 'm',
        unitPrice: 300,
        templates: ['frequent'] as const,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: 'up3',
        description: '大規模足場',
        unit: '式',
        unitPrice: 200000,
        templates: ['large'] as const,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

describe('UnitPriceMasterModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSelect = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useUnitPriceMaster as jest.Mock).mockReturnValue({
            unitPrices: mockItems,
            ensureDataLoaded: jest.fn(),
        });
    });

    it('should return null when isOpen is false', () => {
        const { container } = render(
            <UnitPriceMasterModal isOpen={false} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('should render modal header when isOpen', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(screen.getByText('単価マスターから項目を追加')).toBeInTheDocument();
    });

    it('should render template tabs', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(screen.getByText('よく使う項目')).toBeInTheDocument();
        expect(screen.getByText('大規模見積用')).toBeInTheDocument();
        expect(screen.getByText('中規模見積用')).toBeInTheDocument();
        expect(screen.getByText('住宅見積用')).toBeInTheDocument();
    });

    it('should display items for the selected template', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        // Default tab is 'frequent'
        expect(screen.getByText('足場組立一式')).toBeInTheDocument();
        expect(screen.getByText('メッシュシート')).toBeInTheDocument();
        expect(screen.getByText(/50,000/)).toBeInTheDocument();
    });

    it('should display unit and price for items', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(screen.getByText(/単位: 式/)).toBeInTheDocument();
        expect(screen.getByText(/単位: m/)).toBeInTheDocument();
    });

    it('should display notes when present', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(screen.getByText(/テスト備考/)).toBeInTheDocument();
    });

    it('should switch template tabs', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        fireEvent.click(screen.getByText('大規模見積用'));
        expect(screen.getByText('大規模足場')).toBeInTheDocument();
    });

    it('should show empty state when no items match', () => {
        (useUnitPriceMaster as jest.Mock).mockReturnValue({
            unitPrices: [],
            ensureDataLoaded: jest.fn(),
        });
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        expect(screen.getByText('該当する項目がありません')).toBeInTheDocument();
    });

    it('should toggle item selection with checkbox', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // Select first item
        expect(screen.getByText('選択中:')).toBeInTheDocument();
        expect(screen.getByText('1件')).toBeInTheDocument();
    });

    it('should update selected count when multiple items selected', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[1]);
        expect(screen.getByText('2件')).toBeInTheDocument();
    });

    it('should call onSelect and onClose when add button clicked', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // Select first item

        // Click the add button (find via role to avoid header text match)
        const addButton = screen.getAllByRole('button').find(
            btn => btn.textContent?.match(/追加.*件/)
        );
        fireEvent.click(addButton!);
        expect(mockOnSelect).toHaveBeenCalledWith([mockItems[0]]);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should disable add button when nothing selected', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const addButton = screen.getAllByRole('button').find(
            btn => btn.textContent?.match(/追加.*件/)
        );
        expect(addButton).toBeDisabled();
    });

    it('should call onClose when cancel button clicked', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        fireEvent.click(screen.getByText('キャンセル'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should clear selection when switching tabs', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // Select item
        expect(screen.getByText('1件')).toBeInTheDocument();

        // Switch tab
        fireEvent.click(screen.getByText('大規模見積用'));
        expect(screen.getByText('0件')).toBeInTheDocument();
    });

    it('should deselect item when clicking checkbox again', () => {
        render(
            <UnitPriceMasterModal isOpen={true} onClose={mockOnClose} onSelect={mockOnSelect} />
        );
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // Select
        expect(screen.getByText('1件')).toBeInTheDocument();
        fireEvent.click(checkboxes[0]); // Deselect
        expect(screen.getByText('0件')).toBeInTheDocument();
    });
});
