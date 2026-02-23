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

// Mock child components
jest.mock('@/components/ProjectMasters/ProjectMasterForm', () => ({
    ProjectMasterForm: ({ onSubmit, onCancel, isEdit }: any) => (
        <div data-testid="project-master-form">
            <button onClick={onSubmit}>Submit</button>
            <button onClick={onCancel}>Cancel</button>
            <span>{isEdit ? 'Edit Mode' : 'Create Mode'}</span>
        </div>
    ),
    DEFAULT_FORM_DATA: {
        title: '',
        customerId: '',
        customerName: '',
        constructionContent: '',
        postalCode: '',
        prefecture: '',
        city: '',
        location: '',
        plusCode: '',
        area: '',
        areaRemarks: '',
        assemblyDate: '',
        demolitionDate: '',
        estimatedAssemblyWorkers: '',
        estimatedDemolitionWorkers: '',
        contractAmount: '',
        scaffoldingSpec: {},
        remarks: '',
        createdBy: [],
    }
}));
jest.mock('@/components/ProjectMaster/ProjectProfitDisplay', () => () => <div data-testid="profit-display" />);
jest.mock('@/components/ProjectMaster/WorkHistoryDisplay', () => () => <div data-testid="work-history-display" />);

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Calendar: () => <span data-testid="icon-calendar" />,
    ChevronDown: () => <span data-testid="icon-chevron-down" />,
    ChevronUp: () => <span data-testid="icon-chevron-up" />,
    MapPin: () => <span data-testid="icon-map-pin" />,
    Building: () => <span data-testid="icon-building" />,
}));

const mockProjectMasters = [
    {
        id: 'pm1',
        title: 'Master Project 1',
        status: 'active',
        customerName: 'Customer A',
        updatedAt: '2024-02-01',
        assignments: [],
    },
    {
        id: 'pm2',
        title: 'Master Project 2',
        status: 'completed',
        customerName: 'Customer B',
        updatedAt: '2024-02-02',
        assignments: [],
    },
];

describe('ProjectMasterListPage', () => {
    const mockCreate = jest.fn();
    const mockUpdate = jest.fn();
    const mockDelete = jest.fn();

    beforeEach(() => {
        (useProjectMasters as jest.Mock).mockReturnValue({
            projectMasters: mockProjectMasters,
            isLoading: false,
            createProjectMaster: mockCreate,
            updateProjectMaster: mockUpdate,
            deleteProjectMaster: mockDelete,
        });
        window.confirm = jest.fn(() => true);
    });

    it('should render project master list', () => {
        render(<ProjectMasterListPage />);
        expect(screen.getByText('案件一覧')).toBeInTheDocument();
        // Default filter is 'active', so only Master Project 1 should be visible
        expect(screen.getByText('Master Project 1')).toBeInTheDocument();
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
        expect(screen.getByText('Master Project 1')).toBeInTheDocument();
        expect(screen.queryByText('Master Project 2')).not.toBeInTheDocument();

        // Change to all
        fireEvent.change(statusSelect, { target: { value: 'all' } });
        expect(screen.getByText('Master Project 1')).toBeInTheDocument();
        expect(screen.getByText('Master Project 2')).toBeInTheDocument();
    });

    it('should open create form', () => {
        render(<ProjectMasterListPage />);
        fireEvent.click(screen.getByText('新規案件マスター'));
        expect(screen.getByTestId('project-master-form')).toBeInTheDocument();
        expect(screen.getByText('Create Mode')).toBeInTheDocument();
    });

    it('should open edit form', () => {
        render(<ProjectMasterListPage />);
        const editButton = screen.getAllByTitle('編集')[0];
        fireEvent.click(editButton);
        expect(screen.getByTestId('project-master-form')).toBeInTheDocument();
        expect(screen.getByText('Edit Mode')).toBeInTheDocument();
    });

    it('should expand item details', () => {
        render(<ProjectMasterListPage />);
        // Click expand button (ChevronDown)
        const expandBtn = screen.getAllByTestId('icon-chevron-down')[0].closest('button');
        fireEvent.click(expandBtn!);

        expect(screen.getByTestId('profit-display')).toBeInTheDocument();
        expect(screen.getByTestId('work-history-display')).toBeInTheDocument();
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
