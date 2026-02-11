/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CopyAssignmentModal from '@/components/Calendar/CopyAssignmentModal';
import { CalendarEvent, Employee } from '@/types/calendar';
import toast from 'react-hot-toast';

// Mock toast
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Copy: () => <span data-testid="icon-copy" />,
    Calendar: () => <span data-testid="icon-calendar" />,
}));

describe('CopyAssignmentModal', () => {
    const mockOnClose = jest.fn();
    const mockOnCopy = jest.fn();

    const mockEvent: CalendarEvent = {
        id: 'ev1',
        title: 'Project A',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01'),
        assignedEmployeeId: 'emp1',
        customer: 'Customer X',
        color: '#ff0000',
    };

    const mockEmployees: Employee[] = [
        { id: 'emp1', name: 'Employee 1' },
        { id: 'emp2', name: 'Employee 2' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should not render if isOpen is false', () => {
        render(
            <CopyAssignmentModal
                isOpen={false}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );
        expect(screen.queryByText('案件をコピー')).not.toBeInTheDocument();
    });

    it('should render correct initial values', () => {
        // Today is mocked? No, we use real Date.
        // But the component calculates tomorrow relative to *now*.
        // We can check if fields are populated.

        render(
            <CopyAssignmentModal
                isOpen={true}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );

        expect(screen.getByText('案件をコピー')).toBeInTheDocument();
        expect(screen.getByText('Project A')).toBeInTheDocument();
        expect(screen.getByText('Customer X')).toBeInTheDocument();

        // Employee select should have emp1 selected
        expect(screen.getByRole('combobox')).toHaveValue('emp1');

        // Date inputs should be populated (tomorrow)
        const inputs = screen.getAllByLabelText(/日/); // matches start date and end date labels roughly?
        // Better identifiers:
        // labels are '開始日', '終了日' with icons.
        // But icons mock might interfere with text content matching if not careful?
        // Text match '開始日' works because icon is inline.

        // Let's rely on finding by selector if needed, but getByLabelText is best.
        // labels have text content.
    });

    it('should calculate days count', () => {
        render(
            <CopyAssignmentModal
                isOpen={true}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );

        const startInput = screen.getByLabelText((content) => content.includes('開始日'));
        const endInput = screen.getByLabelText((content) => content.includes('終了日'));

        fireEvent.change(startInput, { target: { value: '2024-02-01' } });
        fireEvent.change(endInput, { target: { value: '2024-02-03' } });

        expect(screen.getByText('3日間')).toBeInTheDocument();
    });

    it('should validate end date >= start date', async () => {
        render(
            <CopyAssignmentModal
                isOpen={true}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );

        const startInput = screen.getByLabelText((content) => content.includes('開始日'));
        const endInput = screen.getByLabelText((content) => content.includes('終了日'));

        // Use a far-future date that is guaranteed > endDate (tomorrow)
        // so the component's auto-update logic triggers: if (startDate > endDate) setEndDate(startDate)
        fireEvent.change(startInput, { target: { value: '2027-06-01' } });

        await waitFor(() => {
            expect(endInput).toHaveValue('2027-06-01');
        });

        // Now change end date to earlier than start date
        fireEvent.change(endInput, { target: { value: '2027-05-01' } });

        // Use fireEvent.submit on the form to bypass HTML5 native min validation
        // (the min attribute on endDate input prevents click-based submission)
        const form = screen.getByRole('button', { name: /コピー/ }).closest('form')!;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('終了日は開始日以降に設定してください');
        });
        expect(mockOnCopy).not.toHaveBeenCalled();
    });

    it('should submit form with correct values', async () => {
        render(
            <CopyAssignmentModal
                isOpen={true}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );

        const startInput = screen.getByLabelText((content) => content.includes('開始日'));
        const endInput = screen.getByLabelText((content) => content.includes('終了日'));
        const select = screen.getByRole('combobox');

        fireEvent.change(startInput, { target: { value: '2024-02-01' } });
        fireEvent.change(endInput, { target: { value: '2024-02-01' } });
        fireEvent.change(select, { target: { value: 'emp2' } });

        const submitButton = screen.getByRole('button', { name: /コピー/ });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockOnCopy).toHaveBeenCalledWith(
                new Date('2024-02-01'),
                new Date('2024-02-01'),
                'emp2'
            );
        });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should handle cancel', () => {
        render(
            <CopyAssignmentModal
                isOpen={true}
                onClose={mockOnClose}
                event={mockEvent}
                employees={mockEmployees}
                onCopy={mockOnCopy}
            />
        );

        const cancelButton = screen.getByText('キャンセル');
        fireEvent.click(cancelButton);
        expect(mockOnClose).toHaveBeenCalled();
    });
});
