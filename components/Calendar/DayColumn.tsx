import React from 'react';
import { WeekDay } from '@/types/calendar';
import { formatDate, getDayOfWeekString } from '@/utils/dateUtils';
import EventCard from './EventCard';

interface DayColumnProps {
    day: WeekDay;
    onEventClick?: (eventId: string) => void;
}

export default function DayColumn({ day, onEventClick }: DayColumnProps) {
    const dayOfWeekString = getDayOfWeekString(day.date, 'short');
    const dateString = formatDate(day.date, 'day');

    return (
        <div className={`
      flex-1 min-w-0 border-r border-gray-200 last:border-r-0
      ${day.isWeekend ? 'bg-slate-50/30' : 'bg-white'}
    `}>
            {/* 日付ヘッダー */}
            <div className={`
        p-3 border-b border-gray-200 text-center
        ${day.isToday ? 'bg-slate-600 text-white' : ''}
        ${day.isWeekend && !day.isToday ? 'bg-slate-100' : ''}
        ${!day.isToday && !day.isWeekend ? 'bg-gray-50' : ''}
      `}>
                <div className={`
          text-xs font-medium mb-1
          ${day.isToday ? 'text-white' : 'text-gray-600'}
        `}>
                    {dayOfWeekString}
                </div>
                <div className={`
          text-lg font-bold
          ${day.isToday ? 'text-white' : ''}
          ${day.isWeekend && !day.isToday ? 'text-slate-600' : 'text-gray-900'}
        `}>
                    {dateString}
                </div>
            </div>

            {/* イベントリスト */}
            <div className="p-2 min-h-[400px]">
                {day.events.length === 0 ? (
                    <div className="text-center text-gray-400 text-sm mt-8">
                        予定なし
                    </div>
                ) : (
                    day.events.map(event => (
                        <EventCard
                            key={event.id}
                            event={event}
                            onClick={() => onEventClick?.(event.id)}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
