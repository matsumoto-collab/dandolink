import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CalendarEvent } from '@/types/calendar';

interface DroppableCellProps {
    id: string; // employeeId-date の形式
    children: React.ReactNode;
    dayOfWeek: number; // 0: Sunday, 1: Monday, ..., 6: Saturday
    events: CalendarEvent[]; // セル内のイベントリスト
    onClick?: () => void; // セルクリック時のハンドラー
}

export default function DroppableCell({ id, children, dayOfWeek, events, onClick }: DroppableCellProps) {
    const { setNodeRef, isOver } = useDroppable({
        id,
    });

    // イベントIDのリストを作成
    const eventIds = events.map(event => event.id);

    const isSaturday = dayOfWeek === 6;
    const isSunday = dayOfWeek === 0;

    // セルクリックで新規登録（イベントカード以外の部分）
    const handleClick = (e: React.MouseEvent) => {
        // イベントカードをクリックした場合は何もしない
        const target = e.target as HTMLElement;
        if (target.closest('[data-event-card]')) {
            return;
        }
        // セルの空白部分をクリックしたらonClickを発火
        if (onClick) {
            onClick();
        }
    };

    return (
        <div
            ref={setNodeRef}
            onClick={handleClick}
            className={`
        flex-1 min-w-[140px] h-full border-r border-gray-200 p-1
        transition-all duration-200
        ${isSaturday ? 'bg-blue-50/40' : isSunday ? 'bg-red-50/40' : 'bg-white'}
        ${isOver ? 'bg-blue-100 ring-2 ring-blue-400 ring-inset shadow-inner' : ''}
        ${onClick ? 'cursor-pointer hover:bg-gray-50/80 hover:shadow-sm' : ''}
      `}
        >
            <SortableContext items={eventIds} strategy={verticalListSortingStrategy}>
                {children}
            </SortableContext>
        </div>
    );
}
