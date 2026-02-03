import { useState, useCallback } from 'react';
import { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import { CalendarEvent } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { arrayMove } from '@dnd-kit/sortable';

interface UseDragAndDropReturn {
    activeId: string | null;
    handleDragStart: (event: DragStartEvent) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    handleDragOver: (event: DragOverEvent) => void;
    handleDragCancel: () => void;
    moveEvent: (eventId: string, newEmployeeId: string, newDate: Date) => void;
}

/**
 * ドラッグ&ドロップのロジックを管理するカスタムフック
 */
export function useDragAndDrop(
    events: CalendarEvent[],
    onEventsChange: (events: CalendarEvent[]) => void
): UseDragAndDropReturn {
    const [activeId, setActiveId] = useState<string | null>(null);

    // イベントを移動（handleDragEndより前に定義）
    const moveEvent = useCallback((
        eventId: string,
        newEmployeeId: string,
        newDate: Date
    ) => {
        const updatedEvents = events.map(event => {
            if (event.id === eventId) {
                return {
                    ...event,
                    assignedEmployeeId: newEmployeeId,
                    startDate: newDate,
                };
            }
            return event;
        });

        onEventsChange(updatedEvents);
    }, [events, onEventsChange]);

    // ドラッグ開始
    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    }, []);

    // ドラッグオーバー（セル内ソート用）
    const handleDragOver = useCallback((event: DragOverEvent) => {
        const { active, over } = event;

        if (!over || active.id === over.id) {
            return;
        }

        // 同じセル内でのソートかどうかを判定
        const activeEvent = events.find(e => e.id === active.id);
        const overEvent = events.find(e => e.id === over.id);

        if (!activeEvent || !overEvent) {
            return;
        }

        // 同じ社員、同じ日付の場合のみソート
        const activeDateKey = formatDateKey(activeEvent.startDate);
        const overDateKey = formatDateKey(overEvent.startDate);

        if (
            activeEvent.assignedEmployeeId === overEvent.assignedEmployeeId &&
            activeDateKey === overDateKey
        ) {
            // このセル内のイベントのみを取得
            const cellEvents = events.filter(e =>
                e.assignedEmployeeId === activeEvent.assignedEmployeeId &&
                formatDateKey(e.startDate) === activeDateKey
            ).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

            const oldIndex = cellEvents.findIndex(e => e.id === active.id);
            const newIndex = cellEvents.findIndex(e => e.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                // セル内のイベントを並び替え
                const reorderedCellEvents = arrayMove(cellEvents, oldIndex, newIndex);

                // 並び替えたセル内イベントのsortOrderを更新
                const cellEventIds = new Set(reorderedCellEvents.map(e => e.id));
                const updatedEvents = events.map(event => {
                    if (cellEventIds.has(event.id)) {
                        const newSortOrder = reorderedCellEvents.findIndex(e => e.id === event.id);
                        return {
                            ...event,
                            sortOrder: newSortOrder,
                        };
                    }
                    return event;
                });
                onEventsChange(updatedEvents);
            }
        }
    }, [events, onEventsChange]);

    // ドラッグ終了（ドロップ）
    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        setActiveId(null);

        if (!over) {
            return;
        }

        // over.idがイベントIDの場合（セル内ソート）とセルIDの場合（セル間移動）を区別
        const overEvent = events.find(e => e.id === over.id);

        if (overEvent) {
            // セル内ソートは handleDragOver で処理済み
            return;
        }

        // セル間移動の処理
        // over.id の形式: "employeeId-date" (例: "user-123-2025-12-15")
        // NOTE: UUIDなどハイフンを含むIDに対応するため、末尾の日付(10文字)で分割
        const dropTargetId = over.id as string;
        const datePart = dropTargetId.slice(-10); // "YYYY-MM-DD"
        const newEmployeeId = dropTargetId.slice(0, -11); // "employeeId"
        const newDateStr = datePart;

        // イベントIDを取得
        const eventId = active.id as string;

        // 新しい日付を作成
        const [year, month, day] = newDateStr.split('-').map(Number);
        const newDate = new Date(year, month - 1, day);

        // イベントを移動
        moveEvent(eventId, newEmployeeId, newDate);
    }, [events, moveEvent]);

    // ドラッグキャンセル
    const handleDragCancel = useCallback(() => {
        setActiveId(null);
    }, []);

    return {
        activeId,
        handleDragStart,
        handleDragEnd,
        handleDragOver,
        handleDragCancel,
        moveEvent,
    };
}
