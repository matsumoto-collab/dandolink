'use client';

import React from 'react';
import { CalendarEvent, WeekDay } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { TENTATIVE_STRIPE_BG, TentativeBadge } from './tentativeStyle';
import { Plus, Users } from 'lucide-react';

interface FloatingLaneProps {
    weekDays: WeekDay[];
    /** 全イベント（内部で assignedEmployeeId='unassigned' をフィルタ） */
    events: CalendarEvent[];
    /** 浮きカードのタップ（昇格モーダルを開く） */
    onEventClick?: (eventId: string) => void;
    /** 空きセルのタップ（浮きの新規登録動線） */
    onCellClick?: (date: Date) => void;
    isReadOnly?: boolean;
    /** モバイル用のコンパクト表示 */
    compact?: boolean;
    /** モバイルの固定幅グリッドに合わせる場合に指定（px）。未指定はデスクトップのflexレイアウト */
    labelWidth?: number;
    colWidth?: number;
}

/** 日付ごとの浮き件数・合計人数（日付ヘッダーの赤バッジ用） */
export function getFloatingSummaryForDate(events: CalendarEvent[], date: Date): { count: number; members: number } {
    const dateKey = formatDateKey(date);
    let count = 0;
    let members = 0;
    for (const e of events) {
        if (e.assignedEmployeeId === 'unassigned' && formatDateKey(e.startDate) === dateKey) {
            count += 1;
            members += e.memberCount ?? 0;
        }
    }
    return { count, members };
}

/**
 * 週間カレンダー最下部の「浮いている」レーン。
 *
 * 浮き = 班が決まっていない仕事（assignedEmployeeId='unassigned'）。従来は
 * 実際には行かない班に載せてマイナス表示で気づく運用だったものを、専用の
 * 置き場所として可視化する（社内用語どおり「浮いている」を画面に使う）。
 * 仮の浮き（dateStatus='tentative'）は斜線＋「(日付も仮)」で区別する。
 */
export default function FloatingLane({
    weekDays,
    events,
    onEventClick,
    onCellClick,
    isReadOnly = false,
    compact = false,
    labelWidth,
    colWidth,
}: FloatingLaneProps) {
    const floating = events.filter((e) => e.assignedEmployeeId === 'unassigned');

    return (
        <div className={`flex border-t-2 border-b-2 border-red-200 bg-red-50/40 ${compact ? 'min-h-[44px]' : 'min-h-[56px]'}`}>
            {/* 左固定ラベル（職長列と同じ幅） */}
            <div className="sticky left-0 z-10 bg-red-50 border-r-2 border-red-200 shadow-sm flex-shrink-0" style={labelWidth ? { width: labelWidth } : undefined}>
                <div className={`${labelWidth ? 'w-full' : compact ? 'w-14' : 'w-20 lg:w-24 xl:w-32'} h-full flex flex-col items-center justify-center px-1`}>
                    <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-red-700 tracking-wide`}>浮いている</span>
                    <span className="text-[9px] text-red-400">班未定</span>
                </div>
            </div>

            {weekDays.map((day, index) => {
                const dateKey = formatDateKey(day.date);
                const dayFloating = floating
                    .filter((e) => formatDateKey(e.startDate) === dateKey)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

                return (
                    <div
                        key={index}
                        style={colWidth ? { width: colWidth } : undefined}
                        className={`${colWidth ? 'grow flex-shrink-0' : `flex-1 ${compact ? 'min-w-[72px]' : 'min-w-[84px]'}`} border-r border-red-100 p-1 ${
                            isReadOnly || !onCellClick ? '' : 'cursor-pointer hover:bg-red-50'
                        }`}
                        onClick={() => {
                            if (!isReadOnly) onCellClick?.(day.date);
                        }}
                    >
                        {dayFloating.map((event) => (
                            <button
                                key={event.id}
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEventClick?.(event.id);
                                }}
                                className="w-full text-left mb-1 p-1 rounded-lg border-2 border-red-300 bg-white shadow-sm hover:brightness-95 relative overflow-hidden"
                                style={event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : undefined}
                            >
                                <div className={`${compact ? 'text-[10px]' : 'text-[10px] xl:text-[11px]'} font-medium text-slate-900 leading-tight truncate`}>
                                    {event.dateStatus === 'tentative' && <TentativeBadge />}
                                    {event.title}
                                </div>
                                <div className="flex items-center gap-1 text-[10px] text-red-700 font-bold whitespace-nowrap">
                                    <Users className="w-3 h-3 flex-shrink-0" />
                                    <span>{event.memberCount ?? 0}人</span>
                                    {event.dateStatus === 'tentative' && (
                                        <span className="text-amber-600 font-medium">(日付も仮)</span>
                                    )}
                                </div>
                            </button>
                        ))}
                        {dayFloating.length === 0 && !isReadOnly && onCellClick && (
                            <div className={`h-full ${compact ? 'min-h-[32px]' : 'min-h-[40px]'} flex items-center justify-center text-red-200`}>
                                <Plus className="w-3.5 h-3.5" />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
