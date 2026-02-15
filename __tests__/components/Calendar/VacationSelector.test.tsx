/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VacationSelector from '@/components/Calendar/VacationSelector';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';

// Mock hooks
jest.mock('@/hooks/useCalendarDisplay');

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Plus: () => <span data-testid="icon-plus" />,
}));

describe('VacationSelector', () => {
    const mockOnAddEmployee = jest.fn();
    const mockOnRemoveEmployee = jest.fn();

    const mockForemen = [
        { id: 'f1', displayName: 'Foreman 1', role: 'foreman1' },
        { id: 'f2', displayName: 'Foreman 2', role: 'foreman1' },
        { id: 'f3', displayName: 'Foreman 3', role: 'foreman2' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useCalendarDisplay as jest.Mock).mockReturnValue({ allForemen: mockForemen });
    });

    const defaultProps = {
        dateKey: '2024-01-01',
        selectedEmployeeIds: ['f1'],
        onAddEmployee: mockOnAddEmployee,
        onRemoveEmployee: mockOnRemoveEmployee,
    };

    it('should render selected employees', () => {
        render(<VacationSelector {...defaultProps} />);

        expect(screen.getByText('Foreman 1')).toBeInTheDocument();
        // Check for removal button by title
        expect(screen.getByTitle('削除')).toBeInTheDocument();
    });

    it('should open dropdown and show available foremen', () => {
        render(<VacationSelector {...defaultProps} />);

        const addButton = screen.getByText('休暇を追加');
        fireEvent.click(addButton);

        // Should show Foreman 2 and Foreman 3 (Foreman 1 is already selected)
        expect(screen.getByText('Foreman 2')).toBeInTheDocument();
        expect(screen.getByText('Foreman 3')).toBeInTheDocument();
        // Foreman 1 appears in the badge but should NOT appear in the dropdown
        // So there should be exactly 1 instance of 'Foreman 1' (the badge)
        expect(screen.getAllByText('Foreman 1')).toHaveLength(1);
    });

    it('should call onAddEmployee when selecting a foreman', () => {
        render(<VacationSelector {...defaultProps} />);

        fireEvent.click(screen.getByText('休暇を追加'));
        fireEvent.click(screen.getByText('Foreman 2'));

        expect(mockOnAddEmployee).toHaveBeenCalledWith('f2');
    });

    it('should call onRemoveEmployee when clicking remove icon', () => {
        render(<VacationSelector {...defaultProps} />);

        const removeButton = screen.getByTitle('削除');
        fireEvent.click(removeButton);

        expect(mockOnRemoveEmployee).toHaveBeenCalledWith('f1');
    });

    it('should close dropdown when clicking outside', () => {
        render(<VacationSelector {...defaultProps} />);

        fireEvent.click(screen.getByText('休暇を追加'));
        expect(screen.getByText('Foreman 2')).toBeInTheDocument();

        // Simulate click outside
        fireEvent.mouseDown(document.body);

        // Dropdown should be closed (Foreman 2 not visible)
        expect(screen.queryByText('Foreman 2')).not.toBeInTheDocument();
    });
});
