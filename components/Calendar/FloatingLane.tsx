'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
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
    /**
     * true のとき各日セルを dnd-kit の droppable（id=`unassigned-${dateKey}`）にする。
     * これで職長行のカードを浮きレーンへ D&D すると toEmployeeId='unassigned' の PendingMove が
     * 届き、降格（別日なら日付移動も）になる。Mobile は DndContext が無いので渡さない。
     */
    enableDrop?: boolean;
    /** 長押し移動モード中か。true のとき各日セルを移動先ターゲットとして表示する */
    isMoving?: boolean;
    /** 移動モード中、セル/カードのタップで呼ぶ（浮きレーンの当該日へ降格移動） */
    onCommitMove?: (date: Date) => void;
}

interface FloatingDroppableCellProps {
    dateKey: string;
    className: string;
    style?: React.CSSProperties;
    onClick: () => void;
    children: React.ReactNode;
}

/**
 * enableDrop 時のみレンダーされる浮きセル。useDroppable は DndContext 内でしか使えないため、
 * フックの条件呼び出しを避ける目的で子コンポーネントへ切り出している（enableDrop=false 時は
 * 呼び出し側が素の div を描画する）。isOver は職長セル（DroppableCell）と同系統の赤で強調する。
 */
function FloatingDroppableCell({ dateKey, className, style, onClick, children }: FloatingDroppableCellProps) {
    const { setNodeRef, isOver } = useDroppable({ id: `unassigned-${dateKey}` });
    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={onClick}
            className={`${className} ${isOver ? 'ring-2 ring-red-400 ring-inset bg-red-100/50' : ''}`}
        >
            {children}
        </div>
    );
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
 * カード自体は職長行の通常カードと同じ見た目（工事種別色）で描画し、仮の浮き
 * （dateStatus='tentative'）は斜線＋「仮」バッジで区別する。
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
    enableDrop = false,
    isMoving = false,
    onCommitMove,
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

                // 移動モード中はセル/カードのタップで commitMove、それ以外は通常の onCellClick/onEventClick
                const interactive = (!isReadOnly && !!onCellClick) || (isMoving && !!onCommitMove);
                const cellClassName = `${colWidth ? 'grow flex-shrink-0' : `flex-1 ${compact ? 'min-w-[72px]' : 'min-w-[84px]'}`} border-r border-red-100 p-1 ${
                    interactive ? 'cursor-pointer hover:bg-red-50' : ''
                }`;
                const handleCellClick = () => {
                    if (isMoving && onCommitMove) {
                        onCommitMove(day.date);
                        return;
                    }
                    if (!isReadOnly) onCellClick?.(day.date);
                };

                const content = (
                    <>
                        {dayFloating.map((event) => (
                            <button
                                key={event.id}
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isMoving && onCommitMove) {
                                        onCommitMove(day.date);
                                        return;
                                    }
                                    onEventClick?.(event.id);
                                }}
                                // 職長行の通常カードと同じ見た目（工事種別色＋仮なら斜線）にして、
                                // 「班を外したカードがそのまま浮きレーンへ移った」ように見せる
                                className="w-full text-left mb-1 p-1 rounded-lg shadow-sm hover:brightness-95 relative overflow-hidden"
                                style={{
                                    backgroundColor: event.color,
                                    ...(event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : {}),
                                }}
                            >
                                {/* 1段目: 現場名（仮なら斜線＋「仮」バッジ） */}
                                <div className={`${compact ? 'text-[10px]' : 'text-[10px] xl:text-[11px]'} font-medium text-slate-900 leading-tight truncate`}>
                                    {event.dateStatus === 'tentative' && <TentativeBadge />}
                                    {event.title}
                                </div>

                                {/* 2段目: 元請名 */}
                                {event.customer && (
                                    <div className="text-[10px] text-slate-700 leading-tight truncate mt-0.5">
                                        {event.customer}
                                    </div>
                                )}

                                {/* 3段目: 人数 + 時間（人数は通常カードと同じ色＝赤字にしない） */}
                                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-700 whitespace-nowrap">
                                    <Users className="w-3 h-3 flex-shrink-0" />
                                    <span>{event.memberCount ?? 0}人</span>
                                    {event.estimatedHours != null && <span>{event.estimatedHours}h</span>}
                                </div>

                                {/* 4段目: 備考 */}
                                {event.remarks && (
                                    <div className="text-[10px] text-slate-700 leading-tight truncate mt-0.5">
                                        {event.remarks}
                                    </div>
                                )}
                            </button>
                        ))}
                        {/* 移動モード中: この日を移動先候補として点線ターゲットで示す（職長セルと同系統・赤） */}
                        {isMoving && onCommitMove && (
                            <div className={`pointer-events-none flex items-center justify-center ${compact ? 'min-h-[28px]' : 'min-h-[32px]'} my-1 border border-dashed border-red-400 text-red-400 rounded`}>
                                <Plus className="w-4 h-4" />
                            </div>
                        )}
                        {/* 空セルの新規登録動線（移動モード中はターゲットを優先して隠す） */}
                        {dayFloating.length === 0 && !isMoving && !isReadOnly && onCellClick && (
                            <div className={`h-full ${compact ? 'min-h-[32px]' : 'min-h-[40px]'} flex items-center justify-center text-red-200`}>
                                <Plus className="w-3.5 h-3.5" />
                            </div>
                        )}
                    </>
                );

                const cellStyle = colWidth ? { width: colWidth } : undefined;

                // enableDrop 時のみ droppable 化（useDroppable の条件呼び出しを避けるため子コンポーネントに委譲）
                return enableDrop && !isReadOnly ? (
                    <FloatingDroppableCell
                        key={index}
                        dateKey={dateKey}
                        className={cellClassName}
                        style={cellStyle}
                        onClick={handleCellClick}
                    >
                        {content}
                    </FloatingDroppableCell>
                ) : (
                    <div
                        key={index}
                        style={cellStyle}
                        className={cellClassName}
                        onClick={handleCellClick}
                    >
                        {content}
                    </div>
                );
            })}
        </div>
    );
}
