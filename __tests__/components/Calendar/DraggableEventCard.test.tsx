import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DraggableEventCard from '@/components/Calendar/DraggableEventCard';
import { CalendarEvent } from '@/types/calendar';

// Mock dnd-kit
jest.mock('@dnd-kit/sortable', () => ({
    useSortable: jest.fn(() => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: null,
        isDragging: false,
    })),
}));

// Mock utilities
jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: jest.fn(),
        },
    },
}));

describe('DraggableEventCard', () => {
    const mockEvent: CalendarEvent = {
        id: 'evt1',
        title: 'Test Project',
        customer: 'Test Customer',
        date: new Date('2024-01-01'),
        color: '#ff0000',
        workers: ['w1', 'w2'],
        remarks: 'Sample remark',
        projectMasterId: 'pm1',
    };

    const mockOnClick = jest.fn();
    const mockOnMoveUp = jest.fn();
    const mockOnMoveDown = jest.fn();
    const mockOnDispatch = jest.fn();
    const mockOnCopy = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders event details correctly', () => {
        render(<DraggableEventCard event={mockEvent} />);

        expect(screen.getByText('Test Project')).toBeInTheDocument();
        expect(screen.getByText('Test Customer')).toBeInTheDocument();
        expect(screen.getByText('2人')).toBeInTheDocument(); // workers length
        expect(screen.getByText('Sample remark')).toBeInTheDocument();
    });

    it('handles click event', () => {
        render(<DraggableEventCard event={mockEvent} onClick={mockOnClick} />);

        fireEvent.click(screen.getByText('Test Project'));
        expect(mockOnClick).toHaveBeenCalled();
    });

    it('handles move up/down actions', () => {
        render(
            <DraggableEventCard
                event={mockEvent}
                canMoveUp={true}
                canMoveDown={true}
                onMoveUp={mockOnMoveUp}
                onMoveDown={mockOnMoveDown}
            />
        );

        fireEvent.click(screen.getByTitle('上に移動'));
        expect(mockOnMoveUp).toHaveBeenCalled();

        fireEvent.click(screen.getByTitle('下に移動'));
        expect(mockOnMoveDown).toHaveBeenCalled();
    });

    it('disables move buttons when cannot move', () => {
        render(
            <DraggableEventCard
                event={mockEvent}
                canMoveUp={false}
                canMoveDown={false}
                onMoveUp={mockOnMoveUp}
                onMoveDown={mockOnMoveDown}
            />
        );

        const upButton = screen.getByTitle('上に移動');
        const downButton = screen.getByTitle('下に移動');

        expect(upButton).toBeDisabled();
        expect(downButton).toBeDisabled();

        // Ensure callbacks not called if somehow clicked
        fireEvent.click(upButton);
        expect(mockOnMoveUp).not.toHaveBeenCalled();
    });

    it('handles dispatch confirmation interaction', () => {
        render(
            <DraggableEventCard
                event={mockEvent}
                canDispatch={true}
                isDispatchConfirmed={false}
                onDispatch={mockOnDispatch}
            />
        );

        const dispatchButton = screen.getByTitle('手配確定');
        fireEvent.click(dispatchButton);
        expect(mockOnDispatch).toHaveBeenCalled();
    });

    it('shows confirmed dispatch state', () => {
        render(
            <DraggableEventCard
                event={mockEvent}
                canDispatch={true}
                isDispatchConfirmed={true}
                onDispatch={mockOnDispatch}
            />
        );

        expect(screen.getByTitle('手配確定済み')).toBeInTheDocument();
    });

    it('handles copy action', () => {
        render(
            <DraggableEventCard
                event={mockEvent}
                onCopy={mockOnCopy}
            />
        );

        const copyButton = screen.getByTitle('コピー');
        fireEvent.click(copyButton);
        expect(mockOnCopy).toHaveBeenCalled();
    });
});
