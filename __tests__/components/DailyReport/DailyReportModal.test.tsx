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

    it('updates work minutes', async () => {
        await act(async () => {
            render(<DailyReportModal {...defaultProps} />);
        });

        // There are 2 projects, look for inputs. 
        // Note: The component uses inputs with format "H:MM". Initial is 8:00 (480 mins) or 0.
        // Let's assume default for new is 8:00 based on component code: setWorkMinutes: 480

        const inputs = screen.getAllByPlaceholderText('0:00');
        // First assignment input
        fireEvent.change(inputs[0], { target: { value: '2:30' } });

        expect(inputs[0]).toHaveValue('2:30');
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
                { assignmentId: 'p1', workMinutes: 120 } // 2:00
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
        // Since we have multiple inputs, finding by value can be tricky if duplicates.
        // 30 mins = 0:30
        expect(screen.getByDisplayValue('0:30')).toBeInTheDocument();
        // 120 mins = 2:00
        expect(screen.getByDisplayValue('2:00')).toBeInTheDocument();
    });

    it('navigates dates', async () => {
        await act(async () => {
            render(<DailyReportModal {...defaultProps} initialDate={new Date('2024-01-01')} />);
        });

        // Previous button (ChevronLeft) - might need accessible name or role
        // The component uses lucide-react icons inside buttons, no aria-label on button but maybe icon?
        // Let's check the code: buttons have onClick but no aria-label. 
        // We'll traverse DOM or rely on finding buttons adjacent to date input.

        // Or finding by role button that contains the icon or has no text.
        // Actually, looking at the code: 
        // <button onClick={goPreviousDay} ...> <ChevronLeft ... /> </button>
        // It's the first button in the date nav section.

        // Let's use getByDisplayValue for the date input to find the container, then buttons.
        const dateInput = screen.getByDisplayValue('2024-01-01');
        const prevButton = dateInput.parentElement?.previousElementSibling as HTMLElement;
        const nextButton = dateInput.parentElement?.nextElementSibling as HTMLElement;

        await act(async () => {
            fireEvent.click(nextButton!);
        });

        expect(dateInput).toHaveValue('2024-01-02');

        await act(async () => {
            fireEvent.click(prevButton!);
        });
        expect(dateInput).toHaveValue('2024-01-01');
    });
});
