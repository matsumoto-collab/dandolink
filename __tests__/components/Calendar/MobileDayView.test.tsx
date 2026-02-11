/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileDayView from '@/components/Calendar/MobileDayView';
import { CalendarEvent, Employee } from '@/types/calendar';

// Mock icons
jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span data-testid="icon-left" />,
    ChevronRight: () => <span data-testid="icon-right" />,
    Calendar: () => <span data-testid="icon-calendar" />,
    Plus: () => <span data-testid="icon-plus" />,
}));

// Mock utils
jest.mock('@/utils/dateUtils', () => ({
    formatDate: jest.fn(() => '2024年1月1日'),
    getDayOfWeekString: jest.fn(() => '月'),
}));

jest.mock('@/utils/employeeUtils', () => ({
    formatDateKey: jest.fn((date) => date.toISOString().split('T')[0]),
}));

describe('MobileDayView', () => {
    const mockDate = new Date('2024-01-01');
    const mockEvents: CalendarEvent[] = [
        {
            id: 'ev1',
            title: 'Project A',
            startDate: new Date('2024-01-01'),
            endDate: new Date('2024-01-01'),
            assignedEmployeeId: 'emp1',
            constructionType: 'assembly',
            color: '#ff0000',
        },
    ];

    const mockEmployees: Employee[] = [
        { id: 'emp1', name: 'Employee 1' },
        { id: 'emp2', name: 'Employee 2' },
    ];

    const mockHandlers = {
        onPreviousDay: jest.fn(),
        onNextDay: jest.fn(),
        onToday: jest.fn(),
        onEventClick: jest.fn(),
        onAddEvent: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render date and employees', () => {
        render(
            <MobileDayView
                currentDate={mockDate}
                events={mockEvents}
                employees={mockEmployees}
                {...mockHandlers}
            />
        );

        expect(screen.getByText(/2024年1月1日/)).toBeInTheDocument();
        expect(screen.getByText('Employee 1')).toBeInTheDocument();
        expect(screen.getByText('Employee 2')).toBeInTheDocument();
    });

    it('should render events for employee', () => {
        render(
            <MobileDayView
                currentDate={mockDate}
                events={mockEvents}
                employees={mockEmployees}
                {...mockHandlers}
            />
        );

        expect(screen.getByText('Project A')).toBeInTheDocument();
        expect(screen.getByText('組立')).toBeInTheDocument();

        // Emp2 has no events
        expect(screen.getByText('予定なし')).toBeInTheDocument();
    });

    it('should handle interactions', () => {
        render(
            <MobileDayView
                currentDate={mockDate}
                events={mockEvents}
                employees={mockEmployees}
                {...mockHandlers}
            />
        );

        fireEvent.click(screen.getByTestId('icon-left'));
        expect(mockHandlers.onPreviousDay).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Project A'));
        expect(mockHandlers.onEventClick).toHaveBeenCalledWith('ev1');

        fireEvent.click(screen.getByTestId('icon-plus'));
        expect(mockHandlers.onAddEvent).toHaveBeenCalled();
    });

    it('should show message if no employees', () => {
        render(
            <MobileDayView
                currentDate={mockDate}
                events={[]}
                employees={[]}
                {...mockHandlers}
            />
        );

        expect(screen.getByText('表示する職長がいません')).toBeInTheDocument();
    });
});
