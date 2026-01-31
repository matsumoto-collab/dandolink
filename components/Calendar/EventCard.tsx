import React, { memo } from 'react';
import { CalendarEvent } from '@/types/calendar';

interface EventCardProps {
    event: CalendarEvent;
    onClick?: () => void;
    compact?: boolean; // コンパクト表示モード
}

const EventCard = memo(function EventCard({ event, onClick, compact = false }: EventCardProps) {
    if (compact) {
        // コンパクト表示(社員別行表示用)
        return (
            <div
                onClick={onClick}
                className="
          mb-1 p-2 rounded-xl border-none
          cursor-pointer transition-all duration-300 ease-out
          hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5
          text-xs relative overflow-hidden
          shadow-md
        "
                style={{
                    backgroundColor: event.color,
                }}
            >
                {/* Gradient overlay for depth */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                {/* 1段目: 現場名 */}
                <div className="font-medium text-white truncate relative z-10">
                    {event.title}
                </div>

                {/* 2段目: 元請名 */}
                {event.customer && (
                    <div className="text-white opacity-90 truncate mt-0.5 relative z-10">
                        {event.customer}
                    </div>
                )}

                {/* 3段目: 人数 */}
                {event.workers && event.workers.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 text-white opacity-90 relative z-10">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span>{event.workers.length}人</span>
                    </div>
                )}

                {/* 4段目: 備考 */}
                {event.remarks && (
                    <div className="flex items-start gap-1 mt-0.5 text-white opacity-90 relative z-10">
                        <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate">{event.remarks}</span>
                    </div>
                )}
            </div>
        );
    }

    // 通常表示
    return (
        <div
            onClick={onClick}
            className="
        mb-2 p-3 rounded-xl border-none
        cursor-pointer transition-all duration-300 ease-out
        hover:shadow-xl hover:scale-[1.03] hover:-translate-y-1
        relative overflow-hidden
        shadow-lg
      "
            style={{
                backgroundColor: event.color,
            }}
        >
            {/* Gradient overlay for depth */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
            <div className="flex items-start justify-between gap-2 relative z-10">
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-white truncate drop-shadow-sm">
                        {event.title}
                    </h4>

                    {event.customer && (
                        <p className="text-xs text-white opacity-90 mt-1 truncate">
                            {event.customer}
                        </p>
                    )}

                    {event.workers && event.workers.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                            <svg className="w-3 h-3 text-white opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span className="text-xs text-white opacity-90">
                                {event.workers.length}名
                            </span>
                        </div>
                    )}

                    {event.remarks && (
                        <div className="flex items-start gap-1 mt-1">
                            <svg className="w-3 h-3 flex-shrink-0 mt-0.5 text-white opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-xs text-white opacity-90 truncate">
                                {event.remarks}
                            </span>
                        </div>
                    )}
                </div>

                {event.status && (
                    <span className={`
            px-2 py-0.5 text-xs rounded-full font-medium bg-white bg-opacity-90
            ${event.status === 'confirmed' ? 'text-green-700' : ''}
            ${event.status === 'pending' ? 'text-yellow-700' : ''}
            ${event.status === 'completed' ? 'text-blue-700' : ''}
            ${event.status === 'cancelled' ? 'text-red-700' : ''}
          `}>
                        {event.status === 'confirmed' && '確定'}
                        {event.status === 'pending' && '保留'}
                        {event.status === 'completed' && '完了'}
                        {event.status === 'cancelled' && '中止'}
                    </span>
                )}
            </div>
        </div>
    );
});

export default EventCard;
