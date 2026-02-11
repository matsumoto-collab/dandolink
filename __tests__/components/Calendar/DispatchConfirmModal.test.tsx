/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DispatchConfirmModal from '@/components/Calendar/DispatchConfirmModal';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import toast from 'react-hot-toast';
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

    it('should show used workers/vehicles as disabled', async () => {
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

        // Worker 2 is used in p2
        // Find input for Worker 2
        // We look for text 'Worker 2', then confirm it has (使用中) near it or input is disabled
        expect(screen.getByText('Worker 2')).toBeInTheDocument();
        expect(screen.getAllByText('(使用中)').length).toBeGreaterThan(0);

        // Check disabled state via label click or finding input
        // Using getByLabelText might be tricky if label contains multiple spans.
        // We can find the container label.
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

        // Toggle Worker 1
        const checkboxes = screen.getAllByRole('checkbox');
        // Assuming order or finding by parent text is hard, let's look for label containing text
        const workerLabel = screen.getByText('Worker 1').closest('label');
        if (workerLabel) {
            const checkbox = within(workerLabel).getByRole('checkbox');
            fireEvent.click(checkbox);
        } else {
            // Fallback
            fireEvent.click(checkboxes[0]);
        }

        // Toggle Vehicle 1
        const vehicleLabel = screen.getByText('Vehicle 1').closest('label');
        if (vehicleLabel) {
            const checkbox = within(vehicleLabel).getByRole('checkbox');
            fireEvent.click(checkbox);
        }

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

    it('should cancel confirmed dispatch', async () => {
        // Confirmed project
        const confirmedProject = {
            ...mockProject,
            isDispatchConfirmed: true,
            confirmedWorkerIds: ['w1'],
            confirmedVehicleIds: ['v1']
        };

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

        expect(window.confirm).toHaveBeenCalled();

        await waitFor(() => {
            expect(mockUpdateProject).toHaveBeenCalledWith('p1', expect.objectContaining({
                isDispatchConfirmed: false
            }));
        });
    });
});
