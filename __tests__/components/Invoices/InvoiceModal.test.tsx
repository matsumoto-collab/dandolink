import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InvoiceModal from '@/components/Invoices/InvoiceModal';

// InvoiceForm モック
jest.mock('@/components/Invoices/InvoiceForm', () => ({
    __esModule: true,
    default: ({ onSubmit, onCancel }: { onSubmit: (data: unknown) => void; onCancel: () => void }) => (
        <div data-testid="invoice-form">
            <button onClick={() => onSubmit({ title: 'Test請求書' })}>保存</button>
            <button onClick={onCancel}>キャンセル</button>
        </div>
    ),
}));

describe('InvoiceModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSubmit = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('表示/非表示', () => {
        it('isOpen=falseの時は何も表示しない', () => {
            const { container } = render(
                <InvoiceModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(container.firstChild).toBeNull();
        });

        it('isOpen=trueの時はモーダルを表示する', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('新規請求書作成')).toBeInTheDocument();
        });
    });

    describe('タイトル', () => {
        it('新規作成時は「新規請求書作成」と表示', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('新規請求書作成')).toBeInTheDocument();
        });

        it('編集時は「請求書編集」と表示', () => {
            render(
                <InvoiceModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    initialData={{ title: '既存請求書' }}
                />
            );
            expect(screen.getByText('請求書編集')).toBeInTheDocument();
        });
    });

    describe('フォーム連携', () => {
        it('InvoiceFormが表示される', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByTestId('invoice-form')).toBeInTheDocument();
        });

        it('フォームの保存でonSubmitとonCloseが呼ばれる', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('保存'));
            expect(mockOnSubmit).toHaveBeenCalledWith({ title: 'Test請求書' });
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('フォームのキャンセルでonCloseが呼ばれる', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('キャンセル'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('オーバーレイ', () => {
        it('オーバーレイクリックでonCloseが呼ばれる', () => {
            render(
                <InvoiceModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            const overlay = document.querySelector('.bg-black.bg-opacity-50');
            fireEvent.click(overlay!);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });
});
