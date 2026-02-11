/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectListPage from '@/app/(master)/projects/page';
import { useProjects } from '@/hooks/useProjects';

// Mock hooks
jest.mock('@/hooks/useProjects');
jest.mock('@/data/mockEmployees', () => ({
    mockEmployees: [
        { id: 'emp1', name: 'Foreman A' },
    ],
}));
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

// Mock dynamic imports
jest.mock('next/dynamic', () => () => {
    const DynamicComponent = () => <div data-testid="mock-project-modal" />;
    return DynamicComponent;
});

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Calendar: () => <span data-testid="icon-calendar" />,
    MapPin: () => <span data-testid="icon-map-pin" />,
    Users: () => <span data-testid="icon-users" />,
    Truck: () => <span data-testid="icon-truck" />,
    Clock: () => <span data-testid="icon-clock" />,
    AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    ArrowUpDown: () => <span data-testid="icon-arrow-up-down" />,
    Filter: () => <span data-testid="icon-filter" />,
    X: () => <span data-testid="icon-x" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Loader2: () => <span data-testid="icon-loader" />,
}));

const mockProjects = [
    {
        id: 'proj1',
        title: 'Project 1',
        customer: 'Customer A',
        startDate: new Date('2024-02-01'),
        assignedEmployeeId: 'emp1',
        workers: ['w1'],
        color: '#ff0000',
    },
    {
        id: 'proj2',
        title: 'Project 2',
        customer: 'Customer B',
        startDate: new Date('2024-02-02'),
        assignedEmployeeId: 'emp2',
        workers: [],
        color: '#00ff00',
    },
];

describe('ProjectListPage', () => {
    const mockAddProject = jest.fn();
    const mockUpdateProject = jest.fn();
    const mockDeleteProject = jest.fn();

    beforeEach(() => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
            isLoading: false,
            addProject: mockAddProject,
            updateProject: mockUpdateProject,
            deleteProject: mockDeleteProject,
        });
        window.confirm = jest.fn(() => true);
    });

    it('should render project list', () => {
        render(<ProjectListPage />);
        expect(screen.getByText('案件一覧')).toBeInTheDocument();
        expect(screen.getAllByText('Project 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Project 2').length).toBeGreaterThan(0);
    });

    it('should show loading state', () => {
        (useProjects as jest.Mock).mockReturnValue({
            projects: [],
            isLoading: true,
            addProject: jest.fn(),
            updateProject: jest.fn(),
            deleteProject: jest.fn(),
        });
        render(<ProjectListPage />);
        expect(screen.queryByText('Project 1')).not.toBeInTheDocument();
        expect(screen.queryByText('Project 2')).not.toBeInTheDocument();
    });

    it('should filter projects by search query', async () => {
        render(<ProjectListPage />);
        const searchInput = screen.getByPlaceholderText('現場名または元請会社名で検索...');
        fireEvent.change(searchInput, { target: { value: 'Customer A' } });

        await waitFor(() => {
            // Customer A matches Project 1
            expect(screen.getAllByText('Project 1').length).toBeGreaterThan(0);
            expect(screen.queryByText('Project 2')).not.toBeInTheDocument();
        });
    });

    it('should open modal on "New Project" click', () => {
        render(<ProjectListPage />);
        // Both desktop "新規案件追加" and mobile "新規追加" are rendered in jsdom
        fireEvent.click(screen.getByText('新規案件追加'));
        expect(screen.getByTestId('mock-project-modal')).toBeInTheDocument();
    });

    it('should handle delete', async () => {
        render(<ProjectListPage />);
        // Find delete buttons by title attribute
        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteProject).toHaveBeenCalled();
        });
    });
});
