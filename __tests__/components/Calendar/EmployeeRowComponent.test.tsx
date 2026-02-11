/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EmployeeRowComponent from '@/components/Calendar/EmployeeRowComponent';
import { EmployeeRow, WeekDay } from '@/types/calendar';

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    ChevronUp: () => <span data-testid="icon-up" />,
    ChevronDown: () => <span data-testid="icon-down" />,
}));

// Mock child components
jest.mock('@/components/Calendar/DraggableEventCard', () => {
    return function MockCard({ event, onClick, onDispatch }: any) {
        return (
            <div data-testid="event-card" onClick={onClick}>
                {event.title}
                {event.isDispatchConfirmed && <span data-testid="dispatch-confirmed" />}
                <button onClick={onDispatch}>Dispatch</button>
            </div>
        );
    };
});

jest.mock('@/components/Calendar/DroppableCell', () => {
    return function MockCell({ children, onClick }: any) {
        return (
            <div data-testid="droppable-cell" onClick={onClick}>
                {children}
            </div>
        );
    };
});

// Mock utils
jest.mock('@/utils/employeeUtils', () => ({
    getEventsForDate: jest.fn(),
    formatDateKey: jest.fn((date) => date.toISOString().split('T')[0]),
}));

import { getEventsForDate } from '@/utils/employeeUtils';

describe('EmployeeRowComponent', () => {
    const mockRow: EmployeeRow = {
        employeeId: 'e1',
        employeeName: 'Employee 1',
        rowIndex: 0,
        events: new Map(),
    };

    const mockWeekDays: WeekDay[] = [
        {
            date: new Date('2024-01-01'),
            dayOfWeek: 1,
            isToday: false,
            isWeekend: false,
            isHoliday: false,
            events: []
        },
        {
            date: new Date('2024-01-02'),
            dayOfWeek: 2,
            isToday: false,
            isWeekend: false,
            isHoliday: false,
            events: []
        },
    ];

    const mockEvents = [
        { id: 'ev1', title: 'Event 1', startDate: new Date('2024-01-01') },
    ];

    const mockOnEventClick = jest.fn();
    const mockOnCellClick = jest.fn();
    const mockOnMoveForeman = jest.fn();
    const mockOnRemoveForeman = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        (getEventsForDate as jest.Mock).mockImplementation((_row: unknown, date: Date) => {
            if (date.toISOString().startsWith('2024-01-01')) return mockEvents;
            return [];
        });
    });

    it('should render employee name', () => {
        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={true}
            />
        );
        expect(screen.getByText('Employee 1')).toBeInTheDocument();
    });

    it('should not render employee name if showEmployeeName is false', () => {
        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={false}
            />
        );
        expect(screen.queryByText('Employee 1')).not.toBeInTheDocument();
    });

    it('should render events in cells', () => {
        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={true}
                projects={[{ id: 'ev1', isDispatchConfirmed: false } as any]}
            />
        );

        expect(screen.getByText('Event 1')).toBeInTheDocument();
        expect(screen.getAllByTestId('droppable-cell')).toHaveLength(2);
    });

    it('should handle cell click', () => {
        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={true}
                onCellClick={mockOnCellClick}
            />
        );

        const cells = screen.getAllByTestId('droppable-cell');
        fireEvent.click(cells[0]);

        expect(mockOnCellClick).toHaveBeenCalledWith('e1', mockWeekDays[0].date);
    });

    it('should handle event click', () => {
        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={true}
                onEventClick={mockOnEventClick}
                projects={[{ id: 'ev1' } as any]}
            />
        );

        fireEvent.click(screen.getByText('Event 1'));
        expect(mockOnEventClick).toHaveBeenCalledWith('ev1');
    });

    it('should show foreman controls and handle actions', () => {
        window.confirm = jest.fn(() => true);

        render(
            <EmployeeRowComponent
                row={mockRow}
                weekDays={mockWeekDays}
                showEmployeeName={true}
                onMoveForeman={mockOnMoveForeman}
                onRemoveForeman={mockOnRemoveForeman}
                isFirst={false}
                isLast={false}
            />
        );

        // Hover group logic is hard to test with fireEvent directly triggering css hover
        // But we can click the buttons if they are in document (opacity 0 doesn't hide from click usually unless display none)
        // The buttons are in the DOM.

        const upButton = screen.getByTitle('上へ移動');
        fireEvent.click(upButton);
        expect(mockOnMoveForeman).toHaveBeenCalledWith('e1', 'up');

        const deleteButton = screen.getByTitle('職長を削除');
        fireEvent.click(deleteButton);
        expect(window.confirm).toHaveBeenCalled();
        expect(mockOnRemoveForeman).toHaveBeenCalledWith('e1');
    });
});
