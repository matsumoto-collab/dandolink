/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DispatchConfirmModal from '@/components/Calendar/DispatchConfirmModal';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { Project } from '@/types/calendar';

// Mock Loading component (uses Loader2 from lucide-react internally)
jest.mock('@/components/ui/Loading', () => {
    return function MockLoading({ text }: { text?: string }) {
        return <div data-testid="loading">{text || 'Loading...'}</div>;
    };
});

// Mock hooks
jest.mock('@/hooks/useMasterData');
jest.mock('@/hooks/useProjects');
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Check: () => <span data-testid="icon-check" />,
    Users: () => <span data-testid="icon-users" />,
    Truck: () => <span data-testid="icon-truck" />,
    Loader2: () => <span data-testid="icon-loader" />,
    ChevronDown: () => <span data-testid="icon-chevron-down" />,
    ChevronUp: () => <span data-testid="icon-chevron-up" />,
}));

describe('DispatchConfirmModal', () => {
    const mockOnClose = jest.fn();
    const mockUpdateProject = jest.fn();

    const mockProject: Project = {
        id: 'p1',
        title: 'Project 1',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01'),
        status: 'pending',
        constructionType: 'assembly',
        description: 'desc',
        confirmedWorkerIds: [],
        confirmedVehicleIds: [],
        isDispatchConfirmed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        color: '#ff0000',
    };

    const mockVehicles = [
        { id: 'v1', name: 'Vehicle 1' },
        { id: 'v2', name: 'Vehicle 2' },
    ];

    const mockWorkers = [
        { id: 'w1', displayName: 'Worker 1', role: 'worker' },
        { id: 'w2', displayName: 'Worker 2', role: 'worker' },
    ];

    const mockProjects = [
        {
            id: 'p2',
            title: 'Project 2',
            startDate: new Date('2024-01-01'),
            endDate: new Date('2024-01-01'),
            isDispatchConfirmed: true,
            confirmedWorkerIds: ['w2'],
            confirmedVehicleIds: ['v2'],
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useMasterData as jest.Mock).mockReturnValue({ vehicles: mockVehicles });
        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
            updateProject: mockUpdateProject
        });

        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockWorkers),
            })
        ) as jest.Mock;
    });

    it('should not render if isOpen is false', () => {
        render(
            <DispatchConfirmModal
                isOpen={false}
                onClose={mockOnClose}
                project={mockProject}
            />
        );
        expect(screen.queryByText('手配確定')).not.toBeInTheDocument();
    });

    it('should render and load users when open', async () => {
        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={mockProject}
            />
        );

        expect(screen.getByText('ユーザーデータを読み込み中...')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('Worker 1')).toBeInTheDocument();
        });

        expect(screen.getByText('Vehicle 1')).toBeInTheDocument();
    });

    it('should show team badge for workers/vehicles used in other teams', async () => {
        // Mock p2 uses w2 and v2 on same day
        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={mockProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Worker 2')).toBeInTheDocument();
        });

        // Worker 2 is used in p2 (no assignedEmployeeId → '他班')
        expect(screen.getAllByText('他班').length).toBeGreaterThan(0);
    });

    it('should toggle selection of available workers/vehicles and confirm', async () => {
        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={mockProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Worker 1')).toBeInTheDocument();
        });

        // Toggle Worker 1 — chip button containing the text
        const workerButton = screen.getByText('Worker 1').closest('button');
        expect(workerButton).not.toBeNull();
        fireEvent.click(workerButton!);

        // Toggle Vehicle 1
        const vehicleButton = screen.getByText('Vehicle 1').closest('button');
        expect(vehicleButton).not.toBeNull();
        fireEvent.click(vehicleButton!);

        // Click Confirm
        const confirmButton = screen.getByText('確定');
        fireEvent.click(confirmButton);

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({
                confirmedWorkerIds: ['w1'],
                confirmedVehicleIds: ['v1'],
                isDispatchConfirmed: true,
            }));
        });
        expect(mockOnClose).toHaveBeenCalled();
    });

    // 解除の起点になる確定済み案件（f1班・2024-01-01）
    const confirmedProject = {
        ...mockProject,
        id: 'p1',
        assignedEmployeeId: 'f1',
        isDispatchConfirmed: true,
        confirmedWorkerIds: ['w1'],
        confirmedVehicleIds: ['v1'],
    };

    it('should cancel only the clicked project when there are no siblings', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [],
            updateProject: mockUpdateProject,
        });
        window.confirm = jest.fn(() => true);

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('確定解除')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('確定解除'));

        // 連動先が無いので確認文言は従来どおりシンプル
        expect((window.confirm as jest.Mock).mock.calls[0][0]).toBe('手配確定を解除しますか？');

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({
                isDispatchConfirmed: false,
                confirmedWorkerIds: undefined,
                confirmedVehicleIds: undefined,
            }));
        });
        expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when the user dismisses the confirm dialog', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [],
            updateProject: mockUpdateProject,
        });
        window.confirm = jest.fn(() => false);

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('確定解除')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('確定解除'));

        expect(window.confirm).toHaveBeenCalled();
        expect(mockUpdateProject).not.toHaveBeenCalled();
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should propagate cancellation to same-team same-day confirmed siblings only', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [
                { id: 'p2', title: 'P2', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },  // 同班・同日・確定 → 連動
                { id: 'p3', title: 'P3', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },  // 同班・同日・確定 → 連動
                { id: 'p4', title: 'P4', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f2', isDispatchConfirmed: true },  // 別班 → 対象外
                { id: 'p5', title: 'P5', startDate: new Date('2024-01-02'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },  // 別日 → 対象外
                { id: 'p6', title: 'P6', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: false }, // 未確定 → 対象外
            ],
            updateProject: mockUpdateProject,
        });
        window.confirm = jest.fn(() => true);

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('確定解除')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('確定解除'));

        expect((window.confirm as jest.Mock).mock.calls[0][0]).toContain('他の案件（2件）も同時に解除されます');

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ isDispatchConfirmed: false }));
        });
        expect(mockUpdateProject).toHaveBeenCalledWith('p2', expect.objectContaining({ isDispatchConfirmed: false }));
        expect(mockUpdateProject).toHaveBeenCalledWith('p3', expect.objectContaining({ isDispatchConfirmed: false }));
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p4', expect.anything());
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p5', expect.anything());
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p6', expect.anything());
    });

    it('should skip siblings that already finished work and note them in the confirm message', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [
                { id: 'p2', title: 'P2', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },
                { id: 'p3', title: 'P3', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true, workEndedAt: new Date('2024-01-01T08:00:00Z') },
            ],
            updateProject: mockUpdateProject,
        });
        window.confirm = jest.fn(() => true);

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('確定解除')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('確定解除'));

        const message = (window.confirm as jest.Mock).mock.calls[0][0] as string;
        expect(message).toContain('他の案件（1件）も同時に解除されます');
        expect(message).toContain('1件は作業完了済みのため解除対象外です');

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ isDispatchConfirmed: false }));
        });
        expect(mockUpdateProject).toHaveBeenCalledWith('p2', expect.objectContaining({ isDispatchConfirmed: false }));
        // 作業完了済みの p3 は連動解除しない
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p3', expect.anything());
    });

    it('should propagate member/vehicle changes to same-team same-day siblings and skip completed ones', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [
                { id: 'p2', title: 'P2', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },                                              // 同班・同日 → 反映
                { id: 'p3', title: 'P3', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true, workEndedAt: new Date('2024-01-01T08:00:00Z') }, // 作業完了済み → スキップ
                { id: 'p4', title: 'P4', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f2', isDispatchConfirmed: true },                                              // 別班 → 対象外
            ],
            updateProject: mockUpdateProject,
        });

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Worker 1')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('確定'));

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ isDispatchConfirmed: true }));
        });
        expect(mockUpdateProject).toHaveBeenCalledWith('p2', expect.objectContaining({
            confirmedWorkerIds: ['w1'],
            confirmedVehicleIds: ['v1'],
            isDispatchConfirmed: true,
        }));
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p3', expect.anything());
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p4', expect.anything());
    });

    it('should NOT propagate when "この案件のみ変更する" is selected', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [
                { id: 'p2', title: 'P2', startDate: new Date('2024-01-01'), assignedEmployeeId: 'f1', isDispatchConfirmed: true },
            ],
            updateProject: mockUpdateProject,
        });

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('この案件のみ変更する')).toBeInTheDocument();
        });

        // 「この案件のみ変更する」を選択（2つ目のラジオ）
        const radios = screen.getAllByRole('radio');
        fireEvent.click(radios[1]);

        fireEvent.click(screen.getByText('確定'));

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ isDispatchConfirmed: true }));
        });
        expect(mockUpdateProject).not.toHaveBeenCalledWith('p2', expect.anything());
    });

    it('should hide the apply-scope radios when there are no eligible siblings', async () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [],
            updateProject: mockUpdateProject,
        });

        render(
            <DispatchConfirmModal
                isOpen={true}
                onClose={mockOnClose}
                project={confirmedProject}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Worker 1')).toBeInTheDocument();
        });

        expect(screen.queryByText('この案件のみ変更する')).not.toBeInTheDocument();
    });
});
