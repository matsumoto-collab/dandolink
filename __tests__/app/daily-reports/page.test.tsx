/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailyReportPage from '@/app/(calendar)/daily-reports/page';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';

// Mock useDebounce to return value immediately
jest.mock('@/hooks/useDebounce', () => ({
    useDebounce: (value: any) => value,
}));

// Mock hooks
jest.mock('@/hooks/useDailyReports');
jest.mock('@/hooks/useCalendarDisplay');
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

// Mock dynamic imports
jest.mock('next/dynamic', () => () => {
    const DynamicComponent = () => <div data-testid="mock-dynamic-component" />;
    return DynamicComponent;
});

// Mock Loading component
jest.mock('@/components/ui/Loading', () => {
    const MockLoading = ({ text }: { text?: string }) => (
        <div data-testid="loading-component">{text || 'Loading...'}</div>
    );
    return MockLoading;
});

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Eye: () => <span data-testid="icon-eye" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Clock: () => <span data-testid="icon-clock" />,
    FileText: () => <span data-testid="icon-file-text" />,
    Calendar: () => <span data-testid="icon-calendar" />,
    ChevronLeft: () => <span data-testid="icon-chevron-left" />,
    ChevronRight: () => <span data-testid="icon-chevron-right" />,
    User: () => <span data-testid="icon-user" />,
    MapPin: () => <span data-testid="icon-map-pin" />,
    Edit: () => <span data-testid="icon-edit" />,
    X: () => <span data-testid="icon-x" />,
}));

const mockDailyReports = [
    {
        id: 'rep1',
        date: new Date('2024-02-10'),
        foremanId: 'foreman1',
        morningLoadingMinutes: 30,
        eveningLoadingMinutes: 20,
        notes: 'Report 1 notes',
        workItems: [
            { id: 'wi1', startTime: '08:00', endTime: '10:00', projectMasterId: 'pm1', constructionType: 'assembly', workerCount: 3 },
        ],
    },
    {
        id: 'rep2',
        date: new Date('2024-02-11'),
        foremanId: 'foreman2',
        morningLoadingMinutes: 15,
        eveningLoadingMinutes: 25,
        notes: 'Report 2 notes',
        workItems: [
            { id: 'wi2', startTime: '08:00', endTime: '11:00', projectMasterId: 'pm2', constructionType: 'demolition', workerCount: 2 },
        ],
    },
];

const mockForemen = [
    { id: 'foreman1', displayName: 'Foreman A' },
    { id: 'foreman2', displayName: 'Foreman B' },
];

describe('DailyReportPage', () => {
    const mockFetchDailyReports = jest.fn();
    const mockDeleteReport = jest.fn();

    beforeEach(() => {
        (useDailyReports as jest.Mock).mockReturnValue({
            dailyReports: mockDailyReports,
            isLoading: false,
            fetchDailyReports: mockFetchDailyReports,
            deleteDailyReport: mockDeleteReport,
        });
        (useCalendarDisplay as jest.Mock).mockReturnValue({
            allForemen: mockForemen,
            getForemanName: (id: string) => {
                const f = mockForemen.find(f => f.id === id);
                return f?.displayName || '不明';
            },
        });
    });

    it('should render daily report list', () => {
        render(<DailyReportPage />);
        expect(screen.getByText('日報一覧')).toBeInTheDocument();
        // Reports show foreman names and notes
        expect(screen.getAllByText('Foreman A').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Foreman B').length).toBeGreaterThan(0);
    });

    it('should filter reports by search query', async () => {
        render(<DailyReportPage />);
        const searchInput = screen.getByPlaceholderText('職長名、備考で検索...');
        fireEvent.change(searchInput, { target: { value: 'Report 1 notes' } });

        await waitFor(() => {
            // Report 1 notes should still be visible
            expect(screen.getAllByText('Report 1 notes').length).toBeGreaterThan(0);
            // Report 2 notes should be filtered out
            expect(screen.queryByText('Report 2 notes')).not.toBeInTheDocument();
        });
    });

    it('should handle report deletion', async () => {
        window.confirm = jest.fn(() => true);
        render(<DailyReportPage />);

        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteReport).toHaveBeenCalled();
        });
    });

    it('should open modal on "New Report" click', () => {
        render(<DailyReportPage />);
        fireEvent.click(screen.getByText('新規日報追加'));
        expect(screen.getAllByTestId('mock-dynamic-component')).toHaveLength(1);
    });

    it('should show loading state', () => {
        (useDailyReports as jest.Mock).mockReturnValue({
            dailyReports: [],
            isLoading: true,
            fetchDailyReports: jest.fn(),
            deleteDailyReport: jest.fn(),
        });
        render(<DailyReportPage />);
        // When loading, the Loading component should be displayed
        expect(screen.getAllByTestId('loading-component').length).toBeGreaterThan(0);
    });
});
