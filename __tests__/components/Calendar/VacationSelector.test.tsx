/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VacationSelector from '@/components/Calendar/VacationSelector';
import { useMasterData } from '@/hooks/useMasterData';

// Mock hooks
jest.mock('@/hooks/useMasterData');

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Plus: () => <span data-testid="icon-plus" />,
}));

describe('VacationSelector', () => {
    const mockOnAddEmployee = jest.fn();
    const mockOnRemoveEmployee = jest.fn();

    const mockWorkers = [
        { id: 'w1', name: 'Worker 1' },
        { id: 'w2', name: 'Worker 2' },
        { id: 'w3', name: 'Worker 3' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (useMasterData as jest.Mock).mockReturnValue({ workers: mockWorkers });
    });

    const defaultProps = {
        dateKey: '2024-01-01',
        selectedEmployeeIds: ['w1'],
        onAddEmployee: mockOnAddEmployee,
        onRemoveEmployee: mockOnRemoveEmployee,
    };

    it('should render selected employees', () => {
        render(<VacationSelector {...defaultProps} />);

        expect(screen.getByText('Worker 1')).toBeInTheDocument();
        // Check for removal button by title
        expect(screen.getByTitle('削除')).toBeInTheDocument();
    });

    it('should open dropdown and show available workers', () => {
        render(<VacationSelector {...defaultProps} />);

        const addButton = screen.getByText('休暇を追加');
        fireEvent.click(addButton);

        // Should show Worker 2 and Worker 3 (Worker 1 is already selected)
        expect(screen.getByText('Worker 2')).toBeInTheDocument();
        expect(screen.getByText('Worker 3')).toBeInTheDocument();
        // Worker 1 appears in the badge but should NOT appear in the dropdown
        // So there should be exactly 1 instance of 'Worker 1' (the badge)
        expect(screen.getAllByText('Worker 1')).toHaveLength(1);
    });

    it('should call onAddEmployee when selecting a worker', () => {
        render(<VacationSelector {...defaultProps} />);

        fireEvent.click(screen.getByText('休暇を追加'));
        fireEvent.click(screen.getByText('Worker 2'));

        expect(mockOnAddEmployee).toHaveBeenCalledWith('w2');
    });

    it('should call onRemoveEmployee when clicking remove icon', () => {
        render(<VacationSelector {...defaultProps} />);

        const removeButton = screen.getByTitle('削除');
        fireEvent.click(removeButton);

        expect(mockOnRemoveEmployee).toHaveBeenCalledWith('w1');
    });

    it('should close dropdown when clicking outside', () => {
        render(<VacationSelector {...defaultProps} />);

        fireEvent.click(screen.getByText('休暇を追加'));
        expect(screen.getByText('Worker 2')).toBeInTheDocument();

        // Simulate click outside
        fireEvent.mouseDown(document.body);

        // Dropdown should be closed (Worker 2 not visible)
        // Note: Using queryByText might still find it if it's just hidden via CSS but here it's conditional rendering
        expect(screen.queryByText('Worker 2')).not.toBeInTheDocument();
    });
});
