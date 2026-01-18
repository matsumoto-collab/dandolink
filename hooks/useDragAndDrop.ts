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
            // セル内でのソート
            const oldIndex = events.findIndex(e => e.id === active.id);
            const newIndex = events.findIndex(e => e.id === over.id);

            if (oldIndex !== newIndex) {
                const newEvents = arrayMove(events, oldIndex, newIndex);
                // sortOrderを更新
                const updatedEvents = newEvents.map((event, index) => ({
                    ...event,
                    sortOrder: index,
                }));
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
        // over.id の形式: "employeeId-date" (例: "2-2025-12-15")
        const dropTargetId = over.id as string;
        const [newEmployeeId, ...dateParts] = dropTargetId.split('-');
        const newDateStr = dateParts.join('-'); // "2025-12-15"

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
