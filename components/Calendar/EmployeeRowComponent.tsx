import React from 'react';
import { EmployeeRow } from '@/types/calendar';
import { WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import DraggableEventCard from './DraggableEventCard';
import DroppableCell from './DroppableCell';

interface EmployeeRowComponentProps {
    row: EmployeeRow;
    weekDays: WeekDay[];
    showEmployeeName: boolean;
    onEventClick?: (eventId: string) => void;
    onCellClick?: (employeeId: string, date: Date) => void;
    onMoveEvent?: (eventId: string, direction: 'up' | 'down') => void;
}

export default function EmployeeRowComponent({
    row,
    weekDays,
    showEmployeeName,
    onEventClick,
    onCellClick,
    onMoveEvent,
}: EmployeeRowComponentProps) {
    return (
        <div className="flex border-b border-gray-200 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200 min-h-[120px]">
            {/* 班長セル（固定） */}
            <div className="sticky left-0 z-10 bg-white border-r-2 border-gray-200 shadow-sm">
                <div className="w-32 h-full flex items-center justify-center px-2">
                    {showEmployeeName && (
                        <span className="text-sm font-semibold text-gray-800 truncate">
                            {row.employeeName}
                        </span>
                    )}
                </div>
            </div>

            {/* 日付セル */}
            {weekDays.map((day, index) => {
                const events = getEventsForDate(row, day.date);
                const dateKey = formatDateKey(day.date);
                const dropId = `${row.employeeId}-${dateKey}`;

                return (
                    <DroppableCell
                        key={`${row.employeeId}-${row.rowIndex}-${index}`}
                        id={dropId}
                        dayOfWeek={day.dayOfWeek}
                        events={events}
                        onClick={() => onCellClick?.(row.employeeId, day.date)}
                    >
                        {events.map((event, eventIndex) => (
                            <DraggableEventCard
                                key={event.id}
                                event={event}
                                onClick={() => onEventClick?.(event.id)}
                                onMoveUp={() => onMoveEvent?.(event.id, 'up')}
                                onMoveDown={() => onMoveEvent?.(event.id, 'down')}
                                canMoveUp={eventIndex > 0}
                                canMoveDown={eventIndex < events.length - 1}
                            />
                        ))}
                    </DroppableCell>
                );
            })}
        </div>
    );
}
