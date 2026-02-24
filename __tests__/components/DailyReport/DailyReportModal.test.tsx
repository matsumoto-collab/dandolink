import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DailyReportModal from '@/components/DailyReport/DailyReportModal';

// Mock mocks
const mockSaveDailyReport = jest.fn();
const mockFetchDailyReports = jest.fn();
const mockGetDailyReportByForemanAndDate = jest.fn();

// Mock hooks
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({
        data: { user: { id: 'u1', name: 'Test User', role: 'worker' } },
        status: 'authenticated',
    })),
}));

jest.mock('@/hooks/useDailyReports', () => ({
    useDailyReports: () => ({
        saveDailyReport: mockSaveDailyReport,
        fetchDailyReports: mockFetchDailyReports,
        getDailyReportByForemanAndDate: mockGetDailyReportByForemanAndDate,
    }),
}));

jest.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        projects: [
            { id: 'p1', title: 'Project A', startDate: new Date('2024-01-01'), assignedEmployeeId: 'u1' },
            { id: 'p2', title: 'Project B', startDate: new Date('2024-01-01'), assignedEmployeeId: 'u1' },
        ],
    }),
}));

jest.mock('@/hooks/useCalendarDisplay', () => ({
    useCalendarDisplay: () => ({
        allForemen: [
            { id: 'u1', displayName: 'Foreman 1' },
            { id: 'u2', displayName: 'Foreman 2' },
        ],
    }),
}));

describe('DailyReportModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: jest.fn(),
        initialDate: new Date('2024-01-01'),
        foremanId: 'u1',
        onSaved: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetDailyReportByForemanAndDate.mockReturnValue(null); // Default new report
    });

    it('renders null when not open', () => {
        const { container } = render(<DailyReportModal {...defaultProps} isOpen={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders correctly when open', async () => {
        await act(async () => {
            render(<DailyReportModal {...defaultProps} />);
        });

        expect(screen.getByText('日報入力')).toBeInTheDocument();
        // Should show project inputs if assignments exist
        expect(screen.getByText('Project A')).toBeInTheDocument();
        expect(screen.getByText('Project B')).toBeInTheDocument();
    });

    it('renders work time selectors', async () => {
        await act(async () => {
            render(<DailyReportModal {...defaultProps} />);
        });

        // The component now uses select dropdowns for start/end time per assignment
        // Verify that the time selection UI elements are rendered
        expect(screen.getByText('案件ごとの作業時間')).toBeInTheDocument();
    });

    it('handles save submission', async () => {
        mockSaveDailyReport.mockResolvedValue({});

        await act(async () => {
            render(<DailyReportModal {...defaultProps} />);
        });

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(mockSaveDailyReport).toHaveBeenCalled();
        });

        expect(screen.getByText('日報を保存しました')).toBeInTheDocument();
    });

    it('loads existing data correctly', async () => {
        mockGetDailyReportByForemanAndDate.mockReturnValue({
            id: 'dr1',
            date: '2024-01-01',
            morningLoadingMinutes: 30, // 0:30
            eveningLoadingMinutes: 0,
            earlyStartMinutes: 0,
            overtimeMinutes: 0,
            workItems: [
                { assignmentId: 'p1', startTime: '08:00', endTime: '10:00' }
            ],
            notes: 'Existing note',
            foremanId: 'u1'
        });

        await act(async () => {
            render(<DailyReportModal {...defaultProps} />);
        });

        expect(mockFetchDailyReports).toHaveBeenCalled();
        expect(screen.getByDisplayValue('Existing note')).toBeInTheDocument();

        // Check formatted time inputs
        // 30 mins = 0:30
        expect(screen.getByDisplayValue('0:30')).toBeInTheDocument();
    });

    it('renders date navigation controls', async () => {
        await act(async () => {
            render(<DailyReportModal {...defaultProps} initialDate={new Date('2024-01-01')} />);
        });

        // Verify date input is present with correct initial value
        const dateInput = screen.getByDisplayValue('2024-01-01');
        expect(dateInput).toBeInTheDocument();

        // Verify the navigation buttons are present (ChevronLeft and ChevronRight)
        // The nav section has 3 children: prevBtn, innerDiv, nextBtn
        const navContainer = dateInput.parentElement?.parentElement;
        expect(navContainer).not.toBeNull();
        const children = navContainer ? Array.from(navContainer.children) : [];
        expect(children.length).toBe(3);
        expect(children[0].tagName).toBe('BUTTON');
        expect(children[2].tagName).toBe('BUTTON');

        // Verify "今日" button is present
        expect(screen.getByText('今日')).toBeInTheDocument();
    });
});
