
import { renderHook, act } from '@testing-library/react';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';

// Mock dependencies
// @dnd-kit/core types are complex to mock perfectly, but we just need objects matching interface
const mockDragEndEvent = (activeId: string, overId: string | null) => ({
    active: { id: activeId },
    over: overId ? { id: overId } : null,
} as any);

const mockDragOverEvent = (activeId: string, overId: string | null) => ({
    active: { id: activeId },
    over: overId ? { id: overId } : null,
} as any);

describe('useDragAndDrop', () => {
    const mockEvents = [
        {
            id: 'event-1',
            startDate: new Date('2023-01-01T00:00:00.000Z'),
            assignedEmployeeId: 'emp-1',
            sortOrder: 0,
        },
        {
            id: 'event-2',
            startDate: new Date('2023-01-01T00:00:00.000Z'),
            assignedEmployeeId: 'emp-1',
            sortOrder: 1,
        },
    ] as any;

    const mockOnEventsChange = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should handle drag start', () => {
        const { result } = renderHook(() => useDragAndDrop(mockEvents, mockOnEventsChange));

        act(() => {
            result.current.handleDragStart({ active: { id: 'event-1' } } as any);
        });

        expect(result.current.activeId).toBe('event-1');
    });

    it('should handle drag cancel', () => {
        const { result } = renderHook(() => useDragAndDrop(mockEvents, mockOnEventsChange));

        act(() => {
            result.current.handleDragStart({ active: { id: 'event-1' } } as any);
        });
        expect(result.current.activeId).toBe('event-1');

        act(() => {
            result.current.handleDragCancel();
        });
        expect(result.current.activeId).toBe(null);
    });

    it('should move event to another day/employee (DragEnd)', () => {
        const { result } = renderHook(() => useDragAndDrop(mockEvents, mockOnEventsChange));

        // Move event-1 to emp-2 on 2023-01-02
        // over.id format: "employeeId-date" -> "emp-2-2023-01-02"
        const overId = 'emp-2-2023-01-02';

        act(() => {
            result.current.handleDragEnd(mockDragEndEvent('event-1', overId));
        });

        expect(mockOnEventsChange).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({
                id: 'event-1',
                assignedEmployeeId: 'emp-2',
                startDate: expect.any(Date), // 2023-01-02
            }),
            expect.objectContaining({
                id: 'event-2', // Unchanged
            })
        ]));

        // precise date check
        const callArgs = mockOnEventsChange.mock.calls[0][0];
        const movedEvent = callArgs.find((e: any) => e.id === 'event-1');
        // Check local time because hook constructs date using local time
        expect(movedEvent.startDate.getFullYear()).toBe(2023);
        expect(movedEvent.startDate.getMonth()).toBe(0); // Jan
        expect(movedEvent.startDate.getDate()).toBe(2);
    });

    it('should sort events within same cell (DragOver)', () => {
        const { result } = renderHook(() => useDragAndDrop(mockEvents, mockOnEventsChange));

        // Drag event-2 (index 1) over event-1 (index 0) in same cell
        // They have same assignedEmployeeId and date
        act(() => {
            result.current.handleDragOver(mockDragOverEvent('event-2', 'event-1'));
        });

        expect(mockOnEventsChange).toHaveBeenCalled();
        const callArgs = mockOnEventsChange.mock.calls[0][0];

        // After swap: event-2 should be index 0, event-1 index 1
        const event2 = callArgs.find((e: any) => e.id === 'event-2');
        const event1 = callArgs.find((e: any) => e.id === 'event-1');

        expect(event2.sortOrder).toBe(0);
        expect(event1.sortOrder).toBe(1);
    });
});
