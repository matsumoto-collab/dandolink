import React from 'react';
import { EmployeeRow, Project } from '@/types/calendar';
import { WeekDay } from '@/types/calendar';
import { getEventsForDate, formatDateKey } from '@/utils/employeeUtils';
import DraggableEventCard from './DraggableEventCard';
import DroppableCell from './DroppableCell';
import { X } from 'lucide-react';

interface EmployeeRowComponentProps {
    row: EmployeeRow;
    weekDays: WeekDay[];
    showEmployeeName: boolean;
    onEventClick?: (eventId: string) => void;
    onCellClick?: (employeeId: string, date: Date) => void;
    onMoveEvent?: (eventId: string, direction: 'up' | 'down') => void;
    onRemoveForeman?: (employeeId: string) => void;
    onDispatch?: (projectId: string) => void;
    canDispatch?: boolean;
    projects?: Project[];
}

export default function EmployeeRowComponent({
    row,
    weekDays,
    showEmployeeName,
    onEventClick,
    onCellClick,
    onMoveEvent,
    onRemoveForeman,
    onDispatch,
    canDispatch = false,
    projects = [],
}: EmployeeRowComponentProps) {

    const handleDelete = () => {
        if (onRemoveForeman) {
            onRemoveForeman(row.employeeId);
        }
    };
    return (
        <div className="flex border-b border-gray-200 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200 min-h-[120px]">
            {/* 班長セル（固定） */}
            <div className="sticky left-0 z-10 bg-white border-r-2 border-gray-200 shadow-sm">
                <div className="w-32 h-full flex items-center justify-center px-2 relative group">
                    {showEmployeeName && (
                        <>
                            <span className="text-xs font-semibold text-gray-700 tracking-wide">
                                {row.employeeName}
                            </span>
                            {onRemoveForeman && (
                                <button
                                    onClick={handleDelete}
                                    className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded-full"
                                    title="職長を削除"
                                >
                                    <X className="w-3 h-3 text-red-600" />
                                </button>
                            )}
                        </>
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
                        {events.map((event, eventIndex) => {
                            // イベントIDからプロジェクトIDを取得
                            const projectId = event.id.replace(/-assembly$|-demolition$/, '');
                            const project = projects.find(p => p.id === projectId);

                            return (
                                <DraggableEventCard
                                    key={event.id}
                                    event={event}
                                    onClick={() => onEventClick?.(event.id)}
                                    onMoveUp={() => onMoveEvent?.(event.id, 'up')}
                                    onMoveDown={() => onMoveEvent?.(event.id, 'down')}
                                    canMoveUp={eventIndex > 0}
                                    canMoveDown={eventIndex < events.length - 1}
                                    onDispatch={() => onDispatch?.(projectId)}
                                    isDispatchConfirmed={project?.isDispatchConfirmed || false}
                                    canDispatch={canDispatch}
                                />
                            );
                        })}
                    </DroppableCell>
                );
            })}
        </div>
    );
}
