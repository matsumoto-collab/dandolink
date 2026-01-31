import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WeeklyCalendar from '@/components/Calendar/WeeklyCalendar';
import { CalendarEvent } from '@/types/calendar';

// --- Mocks ---

// Mock Child Components
jest.mock('@/components/Calendar/CalendarHeader', () => {
    return function MockCalendarHeader({ onNextWeek, onPreviousWeek }: any) {
        return (
            <div data-testid="calendar-header">
                <button onClick={onPreviousWeek}>Prev Week</button>
                <button onClick={onNextWeek}>Next Week</button>
            </div>
        );
    };
});

jest.mock('@/components/Calendar/EmployeeRowComponent', () => {
    return function MockEmployeeRow({ row }: any) {
        return <div data-testid={`employee-row-${row.employeeId}`}>{row.employee.name}</div>;
    };
});

jest.mock('@/components/Calendar/RemarksRow', () => () => <div data-testid="remarks-row">Remarks</div>);
jest.mock('@/components/Calendar/ForemanSelector', () => () => <div data-testid="foreman-selector">ForemanSelector</div>);

// Mock Hooks
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({
        data: { user: { id: 'u1', role: 'admin' } },
        status: 'authenticated',
    })),
}));

const mockFetchForDateRange = jest.fn();
const mockUpdateProject = jest.fn();

jest.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        projects: [],
        addProject: jest.fn(),
        updateProject: mockUpdateProject,
        updateProjects: jest.fn(),
        deleteProject: jest.fn(),
        fetchForDateRange: mockFetchForDateRange,
        isInitialized: true,
    }),
}));

jest.mock('@/hooks/useMasterData', () => ({
    useMasterData: () => ({ totalMembers: 10 }),
}));

jest.mock('@/hooks/useVacation', () => ({
    useVacation: () => ({ getVacationEmployees: () => [] }),
}));

const mockAllForemen = [
    { id: 'f1', displayName: 'Foreman A' },
    { id: 'f2', displayName: 'Foreman B' },
];

jest.mock('@/hooks/useCalendarDisplay', () => ({
    useCalendarDisplay: () => ({
        displayedForemanIds: ['f1', 'f2'],
        removeForeman: jest.fn(),
        allForemen: mockAllForemen,
        moveForeman: jest.fn(),
        isLoading: false,
    }),
}));

const mockGoToNextWeek = jest.fn();
const mockGoToPreviousWeek = jest.fn();

jest.mock('@/hooks/useCalendar', () => ({
    useCalendar: () => ({
        currentDate: new Date('2024-01-01'),
        weekDays: [
            { date: new Date('2024-01-01'), dayOfWeek: 1, isToday: false },
            // ... simplified for test
        ],
        goToPreviousWeek: mockGoToPreviousWeek,
        goToNextWeek: mockGoToNextWeek,
        goToPreviousDay: jest.fn(),
        goToNextDay: jest.fn(),
        goToToday: jest.fn(),
    }),
}));

jest.mock('@/hooks/useDragAndDrop', () => ({
    useDragAndDrop: () => ({
        activeId: null,
        handleDragStart: jest.fn(),
        handleDragEnd: jest.fn(),
        handleDragOver: jest.fn(),
        handleDragCancel: jest.fn(),
    }),
}));

jest.mock('@/hooks/useCalendarModals', () => ({
    useCalendarModals: () => ({
        isModalOpen: false,
        modalInitialData: {},
        handleEventClick: jest.fn(),
        // ... add other necessary mocked returns as empty/defaults
        cellContext: null,
        isSearchModalOpen: false,
        isSelectionModalOpen: false,
        isDispatchModalOpen: false,
        isCopyModalOpen: false,
    }),
}));

// Mock utils that are used in rendering
jest.mock('@/utils/employeeUtils', () => ({
    generateEmployeeRows: (foremen: any) => foremen.map((f: any) => ({ employeeId: f.id, employee: { name: f.name }, cells: [] })),
    formatDateKey: () => '2024-01-01',
}));

jest.mock('@/utils/dateUtils', () => ({
    formatDate: () => '1/1',
    getDayOfWeekString: () => 'Mon',
    addDays: (d: Date, n: number) => d, // simplified
}));

describe('WeeklyCalendar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders calendar structure correctly', async () => {
        await act(async () => {
            render(<WeeklyCalendar />);
        });

        expect(screen.getByTestId('calendar-header')).toBeInTheDocument();
        expect(screen.getByTestId('remarks-row')).toBeInTheDocument();
        expect(screen.getByTestId('foreman-selector')).toBeInTheDocument();

        // Check mocked employee rows
        expect(screen.getByTestId('employee-row-f1')).toBeInTheDocument();
        expect(screen.getByTestId('employee-row-f2')).toBeInTheDocument();
    });

    it('fetches data on mount', async () => {
        await act(async () => {
            render(<WeeklyCalendar />);
        });

        expect(mockFetchForDateRange).toHaveBeenCalled();
    });

    it('handles navigation', async () => {
        await act(async () => {
            render(<WeeklyCalendar />);
        });

        const nextBtn = screen.getByText('Next Week');
        fireEvent.click(nextBtn);
        expect(mockGoToNextWeek).toHaveBeenCalled();

        const prevBtn = screen.getByText('Prev Week');
        fireEvent.click(prevBtn);
        expect(mockGoToPreviousWeek).toHaveBeenCalled();
    });
});
