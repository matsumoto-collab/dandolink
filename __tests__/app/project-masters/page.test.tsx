/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectMasterListPage from '@/app/(master)/project-masters/page';
import { useProjectMasters } from '@/hooks/useProjectMasters';

// Mock hooks
jest.mock('@/hooks/useProjectMasters');
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

// Mock modal components
jest.mock('@/components/ProjectMaster/ProjectMasterCreateModal', () => ({
    __esModule: true,
    default: ({ isOpen, onClose }: any) =>
        isOpen ? (
            <div data-testid="project-master-create-modal">
                <button onClick={onClose}>Cancel</button>
                <span>Create Modal</span>
            </div>
        ) : null,
}));

jest.mock('@/components/ProjectMaster/ProjectMasterDetailModal', () => ({
    __esModule: true,
    default: ({ pm, onClose }: any) =>
        pm ? (
            <div data-testid="project-master-detail-modal">
                <button onClick={onClose}>Close</button>
                <span>{pm.title}</span>
            </div>
        ) : null,
}));

// Mock icons


const mockProjectMasters = [
    {
        id: 'pm1',
        title: 'Master Project 1',
        status: 'active',
        customerName: 'Customer A',
        updatedAt: '2024-02-01',
        assignments: [],
        assignmentCount: 0,
    },
    {
        id: 'pm2',
        title: 'Master Project 2',
        status: 'completed',
        customerName: 'Customer B',
        updatedAt: '2024-02-02',
        assignments: [],
        assignmentCount: 0,
    },
];

describe('ProjectMasterListPage', () => {
    const mockCreate = jest.fn();
    const mockUpdate = jest.fn();
    const mockDelete = jest.fn();
    const mockGetById = jest.fn();

    beforeEach(() => {
        (useProjectMasters as jest.Mock).mockReturnValue({
            projectMasters: mockProjectMasters,
            isLoading: false,
            createProjectMaster: mockCreate,
            updateProjectMaster: mockUpdate,
            deleteProjectMaster: mockDelete,
            getProjectMasterById: mockGetById,
        });
        window.confirm = jest.fn(() => true);
    });

    it('should render project master list', () => {
        render(<ProjectMasterListPage />);
        expect(screen.getByText('案件一覧')).toBeInTheDocument();
        // Default filter is 'active', so only Master Project 1 should be visible
        // Both mobile card and desktop table views render, so use getAllByText
        expect(screen.getAllByText('Master Project 1').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Master Project 2')).not.toBeInTheDocument();
    });

    it('should filter by status', () => {
        render(<ProjectMasterListPage />);
        // There are two comboboxes (search input is not a combobox, but the select elements are)
        const selects = screen.getAllByRole('combobox');
        // The status filter select
        const statusSelect = selects.find(s => {
            const options = s.querySelectorAll('option');
            return Array.from(options).some(o => o.textContent === '全てのステータス');
        })!;

        // Default is active
        // Both mobile card and desktop table views render, so use getAllByText
        expect(screen.getAllByText('Master Project 1').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Master Project 2')).not.toBeInTheDocument();

        // Change to all
        fireEvent.change(statusSelect, { target: { value: 'all' } });
        expect(screen.getAllByText('Master Project 1').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Master Project 2').length).toBeGreaterThanOrEqual(1);
    });

    it('should open create modal', () => {
        render(<ProjectMasterListPage />);
        // The button has text split across elements (icon + text)
        const createBtn = screen.getByTestId('icon-Plus').closest('button');
        fireEvent.click(createBtn!);
        expect(screen.getByTestId('project-master-create-modal')).toBeInTheDocument();
        expect(screen.getByText('Create Modal')).toBeInTheDocument();
    });

    it('should open detail modal on card click', () => {
        render(<ProjectMasterListPage />);
        // Both mobile and desktop views render the title; click the first one
        fireEvent.click(screen.getAllByText('Master Project 1')[0]);
        expect(screen.getByTestId('project-master-detail-modal')).toBeInTheDocument();
    });

    it('should open edit modal on edit button click', () => {
        render(<ProjectMasterListPage />);
        const editButton = screen.getAllByTitle('編集')[0];
        fireEvent.click(editButton);
        expect(screen.getByTestId('project-master-detail-modal')).toBeInTheDocument();
    });

    it('should handle delete', async () => {
        render(<ProjectMasterListPage />);
        const deleteButton = screen.getAllByTitle('削除')[0];
        fireEvent.click(deleteButton);

        await waitFor(() => {
            expect(mockDelete).toHaveBeenCalledWith('pm1');
        });
    });
});
