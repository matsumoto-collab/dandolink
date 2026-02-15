/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VacationSelector from '@/components/Calendar/VacationSelector';

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Plus: () => <span data-testid="icon-plus" />,
}));

const mockMembers = [
    { id: 'm1', displayName: 'Member 1' },
    { id: 'm2', displayName: 'Member 2' },
    { id: 'm3', displayName: 'Member 3' },
];

describe('VacationSelector', () => {
    const mockOnAddEmployee = jest.fn();
    const mockOnRemoveEmployee = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockMembers),
        });
    });

    const defaultProps = {
        dateKey: '2024-01-01',
        selectedEmployeeIds: ['m1'],
        onAddEmployee: mockOnAddEmployee,
        onRemoveEmployee: mockOnRemoveEmployee,
    };

    it('should render selected employees', async () => {
        render(<VacationSelector {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Member 1')).toBeInTheDocument();
        });
        expect(screen.getByTitle('削除')).toBeInTheDocument();
    });

    it('should open dropdown and show available members', async () => {
        render(<VacationSelector {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Member 1')).toBeInTheDocument();
        });

        const addButton = screen.getByText('休暇を追加');
        fireEvent.click(addButton);

        // Should show Member 2 and Member 3 (Member 1 is already selected)
        expect(screen.getByText('Member 2')).toBeInTheDocument();
        expect(screen.getByText('Member 3')).toBeInTheDocument();
        expect(screen.getAllByText('Member 1')).toHaveLength(1);
    });

    it('should call onAddEmployee when selecting a member', async () => {
        render(<VacationSelector {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Member 1')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('休暇を追加'));
        fireEvent.click(screen.getByText('Member 2'));

        expect(mockOnAddEmployee).toHaveBeenCalledWith('m2');
    });

    it('should call onRemoveEmployee when clicking remove icon', async () => {
        render(<VacationSelector {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Member 1')).toBeInTheDocument();
        });

        const removeButton = screen.getByTitle('削除');
        fireEvent.click(removeButton);

        expect(mockOnRemoveEmployee).toHaveBeenCalledWith('m1');
    });

    it('should close dropdown when clicking outside', async () => {
        render(<VacationSelector {...defaultProps} />);

        await waitFor(() => {
            expect(screen.getByText('Member 1')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('休暇を追加'));
        expect(screen.getByText('Member 2')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);

        expect(screen.queryByText('Member 2')).not.toBeInTheDocument();
    });
});
