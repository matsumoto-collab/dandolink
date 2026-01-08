import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarEvent } from '@/types/calendar';
import { ChevronUp, ChevronDown, ClipboardCheck, CheckCircle } from 'lucide-react';

interface DraggableEventCardProps {
    event: CalendarEvent;
    onClick?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    onDispatch?: () => void;
    isDispatchConfirmed?: boolean;
    canDispatch?: boolean;
}

export default function DraggableEventCard({
    event,
    onClick,
    onMoveUp,
    onMoveDown,
    canMoveUp = false,
    canMoveDown = false,
    onDispatch,
    isDispatchConfirmed = false,
    canDispatch = false,
}: DraggableEventCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: event.id,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            data-event-card="true"
            className={`
        mb-1 p-1 rounded-xl border-none
        transition-all duration-300 ease-out
        text-xs relative overflow-hidden
        ${isDragging ? 'shadow-2xl scale-105 z-50' : 'shadow-md hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5'}
      `}
        >
            <div
                className="relative rounded-xl"
                style={{ backgroundColor: event.color }}
            >
                {/* Gradient overlay for depth */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none rounded-xl" />
                <div className="pl-2">
                    {/* ドラッグハンドルと矢印ボタン */}
                    <div className="flex items-start gap-2">
                        <div
                            className="flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing"
                            {...listeners}
                        >
                            <svg
                                className="w-3 h-3 text-gray-600 opacity-70"
                                fill="currentColor"
                                viewBox="0 0 16 16"
                            >
                                <circle cx="3" cy="3" r="1.5" />
                                <circle cx="8" cy="3" r="1.5" />
                                <circle cx="3" cy="8" r="1.5" />
                                <circle cx="8" cy="8" r="1.5" />
                                <circle cx="3" cy="13" r="1.5" />
                                <circle cx="8" cy="13" r="1.5" />
                            </svg>
                        </div>

                        <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isDragging && onClick) {
                                    onClick();
                                }
                            }}
                        >
                            {/* 1段目: 現場名 */}
                            <div className="font-medium text-gray-900 truncate">
                                {event.title}
                            </div>

                            {/* 2段目: 元請名 */}
                            {event.customer && (
                                <div className="text-gray-700 truncate mt-0.5">
                                    {event.customer}
                                </div>
                            )}

                            {/* 3段目: 人数 */}
                            {event.workers && event.workers.length > 0 && (
                                <div className="flex items-center gap-1 mt-0.5 text-gray-700">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    <span>{event.workers.length}人</span>
                                </div>
                            )}

                            {/* 4段目: 備考 */}
                            {event.remarks && (
                                <div className="flex items-start gap-1 mt-0.5 text-gray-700">
                                    <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <span className="truncate">{event.remarks}</span>
                                </div>
                            )}
                        </div>

                        {/* 上下矢印ボタン */}
                        <div className="flex flex-col gap-0.5">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMoveUp?.();
                                }}
                                disabled={!canMoveUp}
                                className={`p-0.5 rounded transition-colors ${canMoveUp
                                    ? 'hover:bg-gray-500 hover:bg-opacity-20 text-gray-700 cursor-pointer'
                                    : 'text-gray-400 opacity-50 cursor-not-allowed'
                                    }`}
                                title="上に移動"
                            >
                                <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onMoveDown?.();
                                }}
                                disabled={!canMoveDown}
                                className={`p-0.5 rounded transition-colors ${canMoveDown
                                    ? 'hover:bg-gray-500 hover:bg-opacity-20 text-gray-700 cursor-pointer'
                                    : 'text-gray-400 opacity-50 cursor-not-allowed'
                                    }`}
                                title="下に移動"
                            >
                                <ChevronDown className="w-3 h-3" />
                            </button>

                            {/* 手配確定ボタン */}
                            {canDispatch && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDispatch?.();
                                    }}
                                    className={`p-0.5 rounded transition-colors ${isDispatchConfirmed
                                        ? 'text-green-600 hover:bg-green-100'
                                        : 'text-gray-700 hover:bg-gray-500 hover:bg-opacity-20'
                                        }`}
                                    title={isDispatchConfirmed ? '手配確定済み' : '手配確定'}
                                >
                                    {isDispatchConfirmed ? (
                                        <CheckCircle className="w-3 h-3" />
                                    ) : (
                                        <ClipboardCheck className="w-3 h-3" />
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
