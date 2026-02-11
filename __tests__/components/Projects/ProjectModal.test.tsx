import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectModal from '@/components/Projects/ProjectModal';

// ProjectForm モック
jest.mock('@/components/Projects/ProjectForm', () => ({
    __esModule: true,
    default: ({ onSubmit, onCancel }: { onSubmit: (data: any) => void; onCancel: () => void }) => (
        <div data-testid="project-form">
            <button onClick={() => onSubmit({ title: 'Test' })}>保存</button>
            <button onClick={onCancel}>キャンセル</button>
        </div>
    ),
}));

// ProjectDetailView モック
jest.mock('@/components/Projects/ProjectDetailView', () => ({
    __esModule: true,
    default: ({ onEdit, onDelete, onClose }: { onEdit: () => void; onDelete: () => void; onClose: () => void }) => (
        <div data-testid="project-detail">
            <button onClick={onEdit}>編集</button>
            <button onClick={onDelete}>削除</button>
            <button onClick={onClose}>閉じる</button>
        </div>
    ),
}));

describe('ProjectModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSubmit = jest.fn();
    const mockOnDelete = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('表示/非表示', () => {
        it('isOpen=falseの時は何も表示しない', () => {
            const { container } = render(
                <ProjectModal isOpen={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(container.firstChild).toBeNull();
        });

        it('isOpen=trueの時はモーダルを表示する', () => {
            render(
                <ProjectModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByText('案件登録')).toBeInTheDocument();
        });
    });

    describe('新規作成モード', () => {
        it('initialDataがない時は編集フォームを表示', () => {
            render(
                <ProjectModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );
            expect(screen.getByTestId('project-form')).toBeInTheDocument();
            expect(screen.getByText('案件登録')).toBeInTheDocument();
        });
    });

    describe('既存案件モード', () => {
        it('initialDataがある時は詳細ビューを表示', () => {
            render(
                <ProjectModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    initialData={{ id: 'proj-1', title: '既存案件' }}
                />
            );
            expect(screen.getByTestId('project-detail')).toBeInTheDocument();
            expect(screen.getByText('案件詳細')).toBeInTheDocument();
        });

        it('編集ボタンで編集モードに切り替わる', async () => {
            render(
                <ProjectModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    initialData={{ id: 'proj-1', title: '既存案件' }}
                />
            );

            fireEvent.click(screen.getByText('編集'));

            await waitFor(() => {
                expect(screen.getByTestId('project-form')).toBeInTheDocument();
            });
        });
    });

    describe('削除機能', () => {
        it('削除ボタンでonDeleteが呼ばれる', () => {
            render(
                <ProjectModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onSubmit={mockOnSubmit}
                    onDelete={mockOnDelete}
                    initialData={{ id: 'proj-1', title: '既存案件' }}
                />
            );

            fireEvent.click(screen.getByText('削除'));
            expect(mockOnDelete).toHaveBeenCalledWith('proj-1');
        });
    });

    describe('オーバーレイクリック', () => {
        it('オーバーレイクリックでonCloseが呼ばれる', () => {
            render(
                <ProjectModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );

            const overlay = document.querySelector('.bg-black.bg-opacity-50');
            fireEvent.click(overlay!);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('ESCキー', () => {
        it('ESCキーでonCloseが呼ばれる', () => {
            render(
                <ProjectModal isOpen={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />
            );

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });
});
