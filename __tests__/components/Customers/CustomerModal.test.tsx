import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomerModal from '@/components/Customers/CustomerModal';

// lucide-react モック
jest.mock('lucide-react', () => ({
    X: () => <svg data-testid="close-icon" />,
    Plus: () => <svg data-testid="plus-icon" />,
    Trash2: () => <svg data-testid="trash-icon" />,
}));

// CustomerForm モック
jest.mock('@/components/Customers/CustomerForm', () => ({
    __esModule: true,
    default: ({ onSubmit, onCancel }: { onSubmit: (data: any) => void; onCancel: () => void }) => (
        <div data-testid="customer-form">
            <button onClick={() => onSubmit({ name: 'Test' })}>保存</button>
            <button onClick={onCancel}>キャンセル</button>
        </div>
    ),
}));

describe('CustomerModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSubmit = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('表示/非表示', () => {
        it('isOpen=falseの時は何も表示しない', () => {
            const { container } = render(
                <CustomerModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(container.firstChild).toBeNull();
        });

        it('isOpen=trueの時はモーダルを表示する', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('顧客登録')).toBeInTheDocument();
        });
    });

    describe('タイトル', () => {
        it('デフォルトタイトルが表示される', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('顧客登録')).toBeInTheDocument();
        });

        it('カスタムタイトルが表示される', () => {
            render(
                <CustomerModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    title="顧客編集"
                />
            );
            expect(screen.getByText('顧客編集')).toBeInTheDocument();
        });
    });

    describe('閉じるボタン', () => {
        it('閉じるボタンでonCloseが呼ばれる', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByTestId('close-icon').closest('button')!);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('フォーム連携', () => {
        it('CustomerFormが表示される', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByTestId('customer-form')).toBeInTheDocument();
        });

        it('フォームのキャンセルでonCloseが呼ばれる', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('キャンセル'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('フォームの保存でonSubmitが呼ばれる', () => {
            render(
                <CustomerModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('保存'));
            expect(mockOnSubmit).toHaveBeenCalled();
        });
    });
});
