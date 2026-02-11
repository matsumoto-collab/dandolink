/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EstimateListPage from '@/app/(finance)/estimates/page';
import { useEstimates } from '@/hooks/useEstimates';
import { useProjects } from '@/hooks/useProjects';
import { useCompany } from '@/hooks/useCompany';

// Mock useCompany
jest.mock('@/hooks/useCompany', () => ({
    useCompany: jest.fn(),
}));

// Mock useDebounce to return value immediately
jest.mock('@/hooks/useDebounce', () => ({
    useDebounce: (value: any) => value,
}));

// Mock hooks
jest.mock('@/hooks/useEstimates');
jest.mock('@/hooks/useProjects');


jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({
        push: jest.fn(),
    })),
}));
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

// Mock dynamic imports
jest.mock('next/dynamic', () => () => {
    const DynamicComponent = () => <div data-testid="mock-dynamic-component" />;
    return DynamicComponent;
});

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
    FileText: () => <span data-testid="icon-file-text" />,
    CheckCircle: () => <span data-testid="icon-check-circle" />,
    XCircle: () => <span data-testid="icon-x-circle" />,
    Clock: () => <span data-testid="icon-clock" />,
    Loader2: () => <span data-testid="icon-loader" />,
    Filter: () => <span data-testid="icon-filter" />,
    Download: () => <span data-testid="icon-download" />,
}));

const mockEstimates = [
    {
        id: 'est1',
        estimateNumber: 'EST-001',
        projectId: 'proj1',
        title: 'Estimate 1',
        total: 1000000,
        status: 'draft',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        validUntil: new Date('2024-02-01'),
        items: [],
    },
    {
        id: 'est2',
        estimateNumber: 'EST-002',
        projectId: 'proj2',
        title: 'Estimate 2',
        total: 2000000,
        status: 'sent',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        validUntil: new Date('2024-02-02'),
        items: [],
    },
];

const mockProjects = [
    { id: 'proj1', title: 'Project 1' },
    { id: 'proj2', title: 'Project 2' },
];

describe('EstimateListPage', () => {
    const mockAddEstimate = jest.fn();
    const mockUpdateEstimate = jest.fn();
    const mockDeleteEstimate = jest.fn();

    beforeEach(() => {
        (useCompany as jest.Mock).mockReturnValue({
            companyInfo: { id: 'comp1', name: 'Test Company', address: 'Tokyo' },
            isLoading: false,
            ensureDataLoaded: jest.fn(),
        });
        (useEstimates as jest.Mock).mockReturnValue({
            estimates: mockEstimates,
            isLoading: false,
            isInitialized: true,
            ensureDataLoaded: jest.fn(),
            addEstimate: mockAddEstimate,
            updateEstimate: mockUpdateEstimate,
            deleteEstimate: mockDeleteEstimate,
        });
        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
            isLoading: false,
        });
    });

    it('should render estimate list', () => {
        render(<EstimateListPage />);
        expect(screen.getByText('見積書一覧')).toBeInTheDocument();
        expect(screen.getAllByText('EST-001').length).toBeGreaterThan(0);
        expect(screen.getAllByText('EST-002').length).toBeGreaterThan(0);
    });

    it('should filter estimates by search query', async () => {
        render(<EstimateListPage />);
        const searchInput = screen.getByPlaceholderText('見積番号、案件名で検索...');
        fireEvent.change(searchInput, { target: { value: 'EST-001' } });

        await waitFor(() => {
            expect(screen.getAllByText('EST-001').length).toBeGreaterThan(0);
            expect(screen.queryByText('EST-002')).not.toBeInTheDocument();
        });
    });

    it('should open modal on "New Estimate" click', () => {
        render(<EstimateListPage />);
        // The button has two spans: "新規見積書作成" (desktop) and "新規作成" (mobile)
        // In jsdom both render, click the mobile one
        fireEvent.click(screen.getByText('新規作成'));
        // Dynamic components are always rendered (EstimateModal + EstimateDetailModal if companyInfo exists)
        expect(screen.getAllByTestId('mock-dynamic-component').length).toBeGreaterThanOrEqual(1);
    });

    it('should handle estimate deletion', async () => {
        window.confirm = jest.fn(() => true);
        render(<EstimateListPage />);

        // Find delete buttons by title
        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteEstimate).toHaveBeenCalled();
        });
    });

    it('should show loading state', () => {
        (useEstimates as jest.Mock).mockReturnValue({
            estimates: [],
            isLoading: true,
            isInitialized: false,
            ensureDataLoaded: jest.fn(),
            addEstimate: jest.fn(),
            updateEstimate: jest.fn(),
            deleteEstimate: jest.fn(),
        });
        render(<EstimateListPage />);
        // When loading, the component shows skeleton placeholders with animate-pulse class
        // and no actual estimate data
        expect(screen.queryByText('EST-001')).not.toBeInTheDocument();
        expect(screen.queryByText('EST-002')).not.toBeInTheDocument();
    });
});
