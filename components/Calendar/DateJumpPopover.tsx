'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarSearch, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, formatDate, isHoliday } from '@/utils/dateUtils';

interface DateJumpButtonProps {
    /** 表示中の週の月曜 */
    currentDate: Date;
    /** 日付を選んだとき（呼び出し側が goToDate に渡す。週の月曜へのスナップは呼び出し側の責務） */
    onSelect: (date: Date) => void;
    /** 'toolbar' = PC ツールバー用（ラベル付き・下にアンカー）/ 'compact' = モバイルナビ用（アイコンのみ・中央カード） */
    variant?: 'toolbar' | 'compact';
    /** コンパクト表示時のアイコンサイズ調整用（MobileCalendarView の isLandscape と揃える） */
    iconClassName?: string;
    /** コンパクト表示時のボタン余白調整用（隣の検索ボタンと揃える） */
    buttonClassName?: string;
    /** 選択可能範囲（将来の協力業者向け。未指定なら制限なし） */
    minDate?: Date;
    maxDate?: Date;
}

/** ツールバー版ポップオーバーの固定幅（px）。アンカー位置の計算に使う */
const POPOVER_WIDTH = 300;

/** 曜日見出し（週間カレンダーと同じ月曜始まり） */
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

/** 日付だけを比較するために時刻を落とした Date を返す */
function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 表示中の週（月〜日）がどの月に属するかを返す（その月の1日）。
 * 週が月をまたぐときは過半が属する月を出したいので、週の木曜（＝ISO週の基準日）で判定する。
 */
function monthOfWeek(weekMonday: Date): Date {
    const thursday = addDays(weekMonday, 3);
    return new Date(thursday.getFullYear(), thursday.getMonth(), 1);
}

export default function DateJumpButton({
    currentDate,
    onSelect,
    variant = 'toolbar',
    iconClassName,
    buttonClassName,
    minDate,
    maxDate,
}: DateJumpButtonProps) {
    const [isOpen, setIsOpen] = useState(false);
    // SSR ではポータル先が無いので、マウント後だけ描画する
    const [isMounted, setIsMounted] = useState(false);
    // グリッドに出す月（その月の1日）。カレンダー本体は動かさず、この state だけを ‹ › で動かす
    const [gridMonth, setGridMonth] = useState<Date>(() => monthOfWeek(currentDate));
    // ツールバー版の表示位置（開いた瞬間のトリガー位置から計算）
    const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const handleToggle = useCallback(() => {
        if (isOpen) {
            setIsOpen(false);
            return;
        }
        // 開くたびに表示月を今の週の月へ戻す
        setGridMonth(monthOfWeek(currentDate));
        if (variant === 'toolbar' && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            // 画面右端からはみ出すときだけ左へ寄せる
            const overflowsRight = rect.left + POPOVER_WIDTH > window.innerWidth;
            setAnchor({
                top: rect.bottom + 6,
                left: overflowsRight ? window.innerWidth - POPOVER_WIDTH - 8 : rect.left,
            });
        }
        setIsOpen(true);
    }, [isOpen, currentDate, variant]);

    // 外側クリック・Escape で閉じる
    useEffect(() => {
        if (!isOpen) return;
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (popoverRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // 日付を確定して閉じる
    const commitSelect = useCallback((date: Date) => {
        onSelect(date);
        setIsOpen(false);
    }, [onSelect]);

    // グリッドの先頭（表示月1日を含む週の月曜）
    const gridStart = useMemo(() => {
        const first = new Date(gridMonth.getFullYear(), gridMonth.getMonth(), 1);
        const dayOfWeek = first.getDay();
        // 日曜(0)は-6、それ以外は1-dayで月曜へ寄せる
        return addDays(first, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    }, [gridMonth]);

    // 6行×7列で固定
    const gridDays = useMemo(
        () => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
        [gridStart]
    );

    // 表示中の週（月〜日）の帯
    const weekRange = useMemo(() => {
        const start = startOfDay(currentDate);
        return { start: start.getTime(), end: addDays(start, 6).getTime() };
    }, [currentDate]);

    const minTime = useMemo(() => (minDate ? startOfDay(minDate).getTime() : null), [minDate]);
    const maxTime = useMemo(() => (maxDate ? startOfDay(maxDate).getTime() : null), [maxDate]);

    // 年 select の選択肢（表示中の週の年 −1 〜 +3。グリッドが範囲外へ出たらその年も足す）
    const yearOptions = useMemo(() => {
        const base = currentDate.getFullYear();
        const years: number[] = [];
        for (let y = base - 1; y <= base + 3; y++) years.push(y);
        const gridYear = gridMonth.getFullYear();
        if (!years.includes(gridYear)) {
            years.push(gridYear);
            years.sort((a, b) => a - b);
        }
        return years;
    }, [currentDate, gridMonth]);

    const todayTime = startOfDay(new Date()).getTime();

    const chipClass = 'px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors';

    const panel = (
        <>
            {/* ヘッダー: ‹ 年 月 › （グリッドの表示月だけを動かす） */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setGridMonth(prev => addMonths(prev, -1))}
                    className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
                    aria-label="前の月"
                    title="前の月"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <select
                    value={gridMonth.getFullYear()}
                    onChange={(e) => setGridMonth(new Date(Number(e.target.value), gridMonth.getMonth(), 1))}
                    className="flex-1 min-w-0 text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1"
                    aria-label="年を選択"
                >
                    {yearOptions.map(year => (
                        <option key={year} value={year}>{year}年</option>
                    ))}
                </select>
                <select
                    value={gridMonth.getMonth()}
                    onChange={(e) => setGridMonth(new Date(gridMonth.getFullYear(), Number(e.target.value), 1))}
                    className="text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1"
                    aria-label="月を選択"
                >
                    {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={i}>{i + 1}月</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => setGridMonth(prev => addMonths(prev, 1))}
                    className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
                    aria-label="次の月"
                    title="次の月"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* 曜日行（月曜始まり） */}
            <div className="mt-2 grid grid-cols-7 gap-0.5">
                {WEEKDAY_LABELS.map((label, i) => (
                    <div
                        key={label}
                        className={`text-center text-[10px] font-semibold py-0.5 ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-400'}`}
                    >
                        {label}
                    </div>
                ))}
            </div>

            {/* 日グリッド（6行×7列固定） */}
            <div className="grid grid-cols-7 gap-0.5">
                {gridDays.map(day => {
                    const time = day.getTime();
                    const isOtherMonth = day.getMonth() !== gridMonth.getMonth();
                    const dayOfWeek = day.getDay();
                    const isDisabled = (minTime !== null && time < minTime) || (maxTime !== null && time > maxTime);
                    const isInWeek = time >= weekRange.start && time <= weekRange.end;
                    const isTodayCell = time === todayTime;

                    // 前後月はグレー優先。当月は日曜・祝日=赤、土曜=青
                    const colorClass = isOtherMonth
                        ? 'text-slate-300'
                        : dayOfWeek === 0 || isHoliday(day)
                            ? 'text-red-600'
                            : dayOfWeek === 6
                                ? 'text-blue-600'
                                : 'text-slate-700';

                    return (
                        <button
                            key={time}
                            type="button"
                            disabled={isDisabled}
                            onClick={() => commitSelect(new Date(day))}
                            aria-label={formatDate(day, 'full')}
                            className={`h-8 rounded-md text-xs transition-colors hover:bg-slate-100
                                ${colorClass}
                                ${isInWeek ? 'bg-teal-50' : ''}
                                ${isTodayCell ? 'ring-1 ring-teal-500 font-bold' : ''}
                                ${isDisabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}`}
                        >
                            {day.getDate()}
                        </button>
                    );
                })}
            </div>

            {/* クイックジャンプ */}
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-semibold">今日から</span>
                    <button type="button" className={chipClass} onClick={() => commitSelect(new Date())}>今週</button>
                    <button type="button" className={chipClass} onClick={() => commitSelect(addMonths(new Date(), 1))}>1ヶ月後</button>
                    <button type="button" className={chipClass} onClick={() => commitSelect(addMonths(new Date(), 3))}>3ヶ月後</button>
                    <button type="button" className={chipClass} onClick={() => commitSelect(addMonths(new Date(), 6))}>半年後</button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-semibold">表示中の週から</span>
                    <button type="button" className={chipClass} onClick={() => commitSelect(addMonths(currentDate, -1))}>1ヶ月前</button>
                    <button type="button" className={chipClass} onClick={() => commitSelect(addMonths(currentDate, 1))}>1ヶ月後</button>
                </div>
            </div>
        </>
    );

    const isToolbar = variant === 'toolbar';
    const triggerBase = isToolbar
        ? 'inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 shadow-sm transition-colors flex-shrink-0 whitespace-nowrap'
        : `rounded-lg transition-colors ${buttonClassName || 'p-1.5'}`;
    const triggerState = isOpen
        ? 'bg-slate-100 text-slate-900'
        : isToolbar
            ? 'bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            : 'text-slate-500 hover:bg-slate-100 active:bg-slate-200';

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleToggle}
                className={`${triggerBase} ${triggerState}`}
                aria-label="日付を指定して移動"
                title="日付を指定して移動"
            >
                <CalendarSearch className={isToolbar ? 'w-4 h-4' : (iconClassName || 'w-4 h-4')} />
                {isToolbar && <span className="hidden xl:inline text-sm font-medium">日付指定</span>}
            </button>

            {/* サイドバー等の重なり順に負けないようポータルで body 直下へ出す */}
            {isMounted && isOpen && createPortal(
                isToolbar ? (
                    <div
                        ref={popoverRef}
                        className="z-[60] bg-white rounded-xl shadow-xl border border-slate-200 p-3"
                        style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: POPOVER_WIDTH }}
                    >
                        {panel}
                    </div>
                ) : (
                    <div
                        className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4"
                        onClick={() => setIsOpen(false)}
                    >
                        <div
                            ref={popoverRef}
                            className="bg-white rounded-xl shadow-xl border border-slate-200 p-3"
                            style={{ width: 'min(320px, 92vw)' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {panel}
                        </div>
                    </div>
                ),
                document.body
            )}
        </>
    );
}
