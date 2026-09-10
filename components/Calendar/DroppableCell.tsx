import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CalendarEvent } from '@/types/calendar';
import { getCalendarDayStyle } from '@/lib/calendarDayStyle';

interface DroppableCellProps {
    id: string; // employeeId-date の形式
    children: React.ReactNode;
    dayOfWeek: number; // 0: Sunday, 1: Monday, ..., 6: Saturday
    /** 日本の祝日。日曜と同じ赤で敷く */
    isHoliday?: boolean;
    events: CalendarEvent[]; // セル内のイベントリスト
    onClick?: () => void; // セルクリック時のハンドラー
}

export default function DroppableCell({ id, children, dayOfWeek, isHoliday, events, onClick }: DroppableCellProps) {
    const { setNodeRef, isOver } = useDroppable({
        id,
    });

    // イベントIDのリストを作成
    const eventIds = events.map(event => event.id);

    const dayStyle = getCalendarDayStyle({ dayOfWeek, isHoliday });

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
            data-testid="calendar-cell"
            onClick={handleClick}
            className={`
        relative group
        flex-1 min-w-[84px] min-h-[80px] sm:min-h-[90px] xl:min-h-[120px] border-r border-slate-200 p-1
        transition-all duration-200
        ${dayStyle.cellBg}
        ${isOver ? 'bg-slate-100 ring-2 ring-slate-400 ring-inset shadow-inner' : ''}
        ${onClick ? `cursor-pointer ${dayStyle.cellHover} hover:shadow-sm` : ''}
      `}
        >
            <SortableContext items={eventIds} strategy={verticalListSortingStrategy}>
                {children}
            </SortableContext>
        </div>
    );
}
