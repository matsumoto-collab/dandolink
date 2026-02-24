/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectDetailView from '@/components/Projects/ProjectDetailView';
import { useMasterData } from '@/hooks/useMasterData';
import { Project } from '@/types/calendar';

// Mock hooks
jest.mock('@/hooks/useMasterData');

// Mock icons (component uses inline SVGs, no lucide-react needed)

describe('ProjectDetailView', () => {
    const mockOnClose = jest.fn();
    const mockOnEdit = jest.fn();
    const mockOnDelete = jest.fn();

    const mockProject: Project = {
        id: 'p1',
        title: 'テストプロジェクト',
        startDate: new Date('2024-06-15'),
        endDate: new Date('2024-06-15'),
        status: 'confirmed',
        constructionType: 'assembly',
        customer: '山田建設',
        description: '',
        color: '#ff0000',
        remarks: 'テスト備考です',
        workers: ['w1', 'w2', 'w3'],
        trucks: ['2tトラック', '4tトラック'],
        createdBy: ['mgr1', 'mgr2'],
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (useMasterData as jest.Mock).mockReturnValue({
            constructionTypes: [
                { id: 'assembly', name: '組立', color: '#4CAF50' },
                { id: 'demolition', name: '解体', color: '#F44336' },
            ],
        });

        // Mock fetch for managers API
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([
                    { id: 'mgr1', displayName: '田中太郎' },
                    { id: 'mgr2', displayName: '佐藤花子' },
                ]),
            })
        ) as jest.Mock;
    });

    it('should render project title and customer', () => {
        render(
            <ProjectDetailView
                project={mockProject}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('テストプロジェクト')).toBeInTheDocument();
        expect(screen.getByText('山田建設')).toBeInTheDocument();
    });

    it('should render status badge', () => {
        render(
            <ProjectDetailView
                project={mockProject}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('確定')).toBeInTheDocument();
    });

    it('should render different status badges', () => {
        const pending = { ...mockProject, status: 'pending' as const };
        const { rerender } = render(
            <ProjectDetailView project={pending} onClose={mockOnClose} />
        );
        expect(screen.getByText('保留')).toBeInTheDocument();

        const completed = { ...mockProject, status: 'completed' as const };
        rerender(<ProjectDetailView project={completed} onClose={mockOnClose} />);
        expect(screen.getByText('完了')).toBeInTheDocument();
    });

    it('should render construction type from master data', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );
        expect(screen.getByText('組立')).toBeInTheDocument();
    });

    it('should show manager names after async load', async () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );

        await waitFor(() => {
            expect(screen.getByText('田中太郎')).toBeInTheDocument();
        });
        expect(screen.getByText('佐藤花子')).toBeInTheDocument();
    });

    it('should render member count', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );
        expect(screen.getByText('3名')).toBeInTheDocument();
    });

    it('should render trucks', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );
        expect(screen.getByText('2tトラック')).toBeInTheDocument();
        expect(screen.getByText('4tトラック')).toBeInTheDocument();
    });

    it('should render remarks', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );
        expect(screen.getByText('テスト備考です')).toBeInTheDocument();
    });

    it('should call onClose when close button clicked', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} onEdit={mockOnEdit} />
        );
        fireEvent.click(screen.getByText('閉じる'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onEdit when edit button clicked', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} onEdit={mockOnEdit} />
        );
        fireEvent.click(screen.getByText('編集'));
        expect(mockOnEdit).toHaveBeenCalled();
    });

    it('should show delete confirmation dialog and call onDelete', async () => {
        render(
            <ProjectDetailView
                project={mockProject}
                onClose={mockOnClose}
                onDelete={mockOnDelete}
            />
        );

        // Wait for async effects to settle
        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });

        // Click the action area delete button
        const allButtons = screen.getAllByRole('button');
        const actionDeleteButton = allButtons.find(btn =>
            btn.textContent?.includes('削除') && btn.className.includes('border-slate-300')
        );
        expect(actionDeleteButton).toBeTruthy();
        fireEvent.click(actionDeleteButton!);

        // Confirmation dialog appears
        expect(screen.getByText('案件を削除しますか？')).toBeInTheDocument();
        expect(screen.getByText(/この操作は元に戻せません/)).toBeInTheDocument();

        // Confirm deletion - find the red confirmation button in the dialog
        const dialogButtons = screen.getAllByRole('button');
        const confirmButton = dialogButtons.find(btn =>
            btn.textContent === '削除' && btn.className.includes('bg-slate-700')
        );
        expect(confirmButton).toBeTruthy();
        fireEvent.click(confirmButton!);
        expect(mockOnDelete).toHaveBeenCalled();
    });

    it('should cancel delete confirmation', async () => {
        render(
            <ProjectDetailView
                project={mockProject}
                onClose={mockOnClose}
                onDelete={mockOnDelete}
            />
        );

        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });

        // Open dialog
        const allButtons = screen.getAllByRole('button');
        const actionDeleteButton = allButtons.find(btn =>
            btn.textContent?.includes('削除') && btn.className.includes('border-slate-300')
        );
        fireEvent.click(actionDeleteButton!);
        expect(screen.getByText('案件を削除しますか？')).toBeInTheDocument();

        // Cancel
        fireEvent.click(screen.getByText('キャンセル'));
        expect(screen.queryByText('案件を削除しますか？')).not.toBeInTheDocument();
        expect(mockOnDelete).not.toHaveBeenCalled();
    });

    it('should hide edit and delete buttons when readOnly', () => {
        render(
            <ProjectDetailView
                project={mockProject}
                onClose={mockOnClose}
                onEdit={mockOnEdit}
                onDelete={mockOnDelete}
                readOnly={true}
            />
        );
        expect(screen.queryByText('編集')).not.toBeInTheDocument();
        // Delete button should not appear in action area
        expect(screen.queryByText('削除')).not.toBeInTheDocument();
    });

    it('should show loading state for managers', () => {
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );
        expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    });

    it('should fallback to manager ID when fetch fails', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('fail'));
        render(
            <ProjectDetailView project={mockProject} onClose={mockOnClose} />
        );

        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });
        // Falls back to raw IDs
        expect(screen.getByText('mgr1')).toBeInTheDocument();
    });
});
