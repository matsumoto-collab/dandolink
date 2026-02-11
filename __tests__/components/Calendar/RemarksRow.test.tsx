/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RemarksRow from '@/components/Calendar/RemarksRow';
import { useVacation } from '@/hooks/useVacation';

// Mock hooks
jest.mock('@/hooks/useVacation');

// Mock VacationSelector to simplify testing
jest.mock('@/components/Calendar/VacationSelector', () => {
    return function MockVacationSelector(props: any) {
        return (
            <div data-testid="vacation-selector">
                Selected: {props.selectedEmployeeIds.join(', ')}
                <button onClick={() => props.onAddEmployee('w1')}>Add W1</button>
            </div>
        );
    };
});

describe('RemarksRow', () => {
    const mockGetRemarks = jest.fn();
    const mockSetRemarks = jest.fn();
    const mockGetVacationEmployees = jest.fn();
    const mockAddVacationEmployee = jest.fn();
    const mockRemoveVacationEmployee = jest.fn();

    const mockWeekDays = [
        { date: new Date('2024-01-01'), dayOfWeek: 1, isToday: false, isWeekend: false, isHoliday: false, events: [] as any[] },
        { date: new Date('2024-01-02'), dayOfWeek: 2, isToday: false, isWeekend: false, isHoliday: false, events: [] as any[] },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useVacation as jest.Mock).mockReturnValue({
            getRemarks: mockGetRemarks,
            setRemarks: mockSetRemarks,
            getVacationEmployees: mockGetVacationEmployees,
            addVacationEmployee: mockAddVacationEmployee,
            removeVacationEmployee: mockRemoveVacationEmployee,
        });

        mockGetRemarks.mockImplementation((dateKey) => {
            if (dateKey === '2024-01-01') return 'Remark 1';
            return '';
        });

        mockGetVacationEmployees.mockReturnValue([]);
    });

    it('should render remarks correctly', () => {
        render(<RemarksRow weekDays={mockWeekDays} />);

        expect(screen.getByText('備考')).toBeInTheDocument();
        expect(screen.getByText('Remark 1')).toBeInTheDocument();
        expect(screen.getAllByText('クリックして入力').length).toBeGreaterThan(0);
    });

    it('should switch to edit mode on click and save on blur', () => {
        render(<RemarksRow weekDays={mockWeekDays} />);

        // Click cell for 2024-01-02 (empty)
        const emptyCells = screen.getAllByText('クリックして入力');
        fireEvent.click(emptyCells[0]);

        const textarea = screen.getByRole('textbox');
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveValue('');

        // Type new value
        fireEvent.change(textarea, { target: { value: 'New Remark' } });
        expect(textarea).toHaveValue('New Remark');

        // Blur to save
        fireEvent.blur(textarea);

        expect(mockSetRemarks).toHaveBeenCalledWith('2024-01-02', 'New Remark');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('should save on Enter key', () => {
        render(<RemarksRow weekDays={mockWeekDays} />);

        const emptyCells = screen.getAllByText('クリックして入力');
        fireEvent.click(emptyCells[0]);

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'Enter Save' } });
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

        expect(mockSetRemarks).toHaveBeenCalledWith('2024-01-02', 'Enter Save');
    });

    it('should cancel edit on Escape key', () => {
        render(<RemarksRow weekDays={mockWeekDays} />);

        const emptyCells = screen.getAllByText('クリックして入力');
        fireEvent.click(emptyCells[0]);

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'Cancel This' } });
        fireEvent.keyDown(textarea, { key: 'Escape' });

        expect(mockSetRemarks).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        // Should revert to original (empty) display — re-query since DOM was rebuilt
        expect(screen.getAllByText('クリックして入力').length).toBeGreaterThan(0);
    });

    it('should pass correct props to VacationSelector', () => {
        render(<RemarksRow weekDays={mockWeekDays} />);

        // VacationSelector is mocked
        expect(screen.getAllByTestId('vacation-selector')).toHaveLength(2);

        // Simulate interaction via mock button
        const addButtons = screen.getAllByText('Add W1');
        fireEvent.click(addButtons[0]);

        expect(mockAddVacationEmployee).toHaveBeenCalledWith('2024-01-01', 'w1');
    });
});
