import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EstimateModal from '@/components/Estimates/EstimateModal';

// EstimateForm モック
jest.mock('@/components/Estimates/EstimateForm', () => ({
    __esModule: true,
    default: ({ onSubmit, onCancel }: { onSubmit: (data: unknown) => void; onCancel: () => void }) => (
        <div data-testid="estimate-form">
            <button onClick={() => onSubmit({ title: 'Test見積' })}>保存</button>
            <button onClick={onCancel}>キャンセル</button>
        </div>
    ),
}));

describe('EstimateModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSubmit = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('表示/非表示', () => {
        it('isOpen=falseの時は何も表示しない', () => {
            const { container } = render(
                <EstimateModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(container.firstChild).toBeNull();
        });

        it('isOpen=trueの時はモーダルを表示する', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('新規見積書作成')).toBeInTheDocument();
        });
    });

    describe('タイトル', () => {
        it('新規作成時は「新規見積書作成」と表示', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('新規見積書作成')).toBeInTheDocument();
        });

        it('編集時は「見積書編集」と表示', () => {
            render(
                <EstimateModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    initialData={{ title: '既存見積' }}
                />
            );
            expect(screen.getByText('見積書編集')).toBeInTheDocument();
        });
    });

    describe('閉じるボタン', () => {
        it('閉じるボタンでonCloseが呼ばれる', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            // SVGの閉じるボタンを取得
            const closeButton = screen.getByRole('button', { name: '' });
            fireEvent.click(closeButton);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('オーバーレイクリック', () => {
        it('オーバーレイクリックでonCloseが呼ばれる', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );

            const overlay = document.querySelector('.bg-black.bg-opacity-50');
            fireEvent.click(overlay!);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('フォーム連携', () => {
        it('EstimateFormが表示される', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByTestId('estimate-form')).toBeInTheDocument();
        });

        it('フォームのキャンセルでonCloseが呼ばれる', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('キャンセル'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('フォームの保存でonSubmitとonCloseが呼ばれる', () => {
            render(
                <EstimateModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            fireEvent.click(screen.getByText('保存'));
            expect(mockOnSubmit).toHaveBeenCalledWith({ title: 'Test見積' });
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });
});
