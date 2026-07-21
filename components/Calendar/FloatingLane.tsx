'use client';

import React, { useRef, useCallback } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CalendarEvent, WeekDay } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { TENTATIVE_STRIPE_BG, TentativeBadge } from './tentativeStyle';
import CellRemarkInput from './CellRemarkInput';
import { Plus, Users, ChevronUp, ChevronDown } from 'lucide-react';

const LONG_PRESS_MS = 500;        // 長押し判定時間（DraggableEventCard と揃える）
const LONG_PRESS_TOLERANCE = 6;   // 長押し中に許容する指/カーソルの移動量（px）

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
    /**
     * true のとき浮きカード自体を dnd-kit の draggable（id=イベントID）にする。
     * 別日の浮きセルへ落とせば「浮きのまま日付移動」、職長セルへ落とせば「昇格」になる。
     * useDraggable は DndContext 内でしか使えないため、これも Mobile では渡さない（PC専用）。
     */
    enableDrag?: boolean;
    /** カードの長押し（PC/スマホ共通）で移動モードを開始する。渡されたときだけ長押しを有効化 */
    onLongPressEvent?: (event: CalendarEvent) => void;
    /** 移動モード中の移動元カードID（ハイライト表示用） */
    movingEventId?: string | null;
    /** 長押し移動モード中か。true のとき各日セルを移動先ターゲットとして表示する */
    isMoving?: boolean;
    /** 移動モード中、セル/カードのタップで呼ぶ（浮きレーンの当該日へ降格移動） */
    onCommitMove?: (date: Date) => void;
    /**
     * レーン自体の並び替え（職長行の▲▼と同じ操作）。渡されたときだけラベルに▲▼を出す。
     * 位置は職長の並び順設定に相乗りして保存される（lib/floatingLaneOrder.ts）
     */
    onMoveLane?: (direction: 'up' | 'down') => void;
    /** ▲を出すか（一番上なら false） */
    canMoveUp?: boolean;
    /** ▼を出すか（一番下なら false） */
    canMoveDown?: boolean;
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

/**
 * カードの長押し検出（マウス／タッチ／ペン共通）。DraggableEventCard の実装に倣い、
 * 500ms 保持で成立させ、6px 以上動いたらキャンセルする（スクロール・ドラッグと両立）。
 * 長押し成立直後の click を握り潰すため firedRef を返す。
 */
function useLongPress(onLongPress?: () => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef<{ x: number; y: number } | null>(null);
    const firedRef = useRef(false);

    const clear = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!onLongPress) return;
        if (e.button !== undefined && e.button !== 0) return; // 主ボタンのみ
        firedRef.current = false;
        startPos.current = { x: e.clientX, y: e.clientY };
        clear();
        timer.current = setTimeout(() => {
            timer.current = null;
            firedRef.current = true;
            navigator.vibrate?.(60);
            onLongPress();
        }, LONG_PRESS_MS);
    }, [onLongPress, clear]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (!startPos.current) return;
        const dx = Math.abs(e.clientX - startPos.current.x);
        const dy = Math.abs(e.clientY - startPos.current.y);
        if (dx > LONG_PRESS_TOLERANCE || dy > LONG_PRESS_TOLERANCE) {
            clear();
            startPos.current = null;
        }
    }, [clear]);

    const onPointerEnd = useCallback(() => {
        clear();
        startPos.current = null;
    }, [clear]);

    return { firedRef, onPointerDown, onPointerMove, onPointerEnd };
}

/** 浮きカードの中身（職長行の通常カードと同じ見た目：工事種別色＋仮なら斜線＋「仮」バッジ） */
function FloatingCardBody({ event, compact }: { event: CalendarEvent; compact: boolean }) {
    return (
        <>
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
        </>
    );
}

const CARD_BASE_CLASS = 'w-full text-left mb-1 p-1 rounded-lg shadow-sm hover:brightness-95 relative overflow-hidden select-none';

interface FloatingCardCommonProps {
    event: CalendarEvent;
    compact: boolean;
    /** 移動モード中の移動元カードならリング表示 */
    isMovingSource: boolean;
    /** クリック（タップ）。長押し成立直後は握り潰す */
    onClick: (e: React.MouseEvent) => void;
    /** 長押し（未指定なら長押し無効） */
    onLongPress?: () => void;
}

/**
 * enableDrag=false 時（モバイル・閲覧専用）の浮きカード。button のまま長押し移動に対応する。
 * DndContext を持たないモバイルでも長押し→移動先タップの経路が使える。
 */
function FloatingPlainCard({ event, compact, isMovingSource, onClick, onLongPress }: FloatingCardCommonProps) {
    const lp = useLongPress(onLongPress);
    return (
        <button
            type="button"
            onPointerDownCapture={lp.onPointerDown}
            onPointerMoveCapture={lp.onPointerMove}
            onPointerUpCapture={lp.onPointerEnd}
            onPointerCancelCapture={lp.onPointerEnd}
            onClick={(e) => {
                // 長押し成立直後の click は握り潰す（移動モードへ入っただけで昇格モーダルを開かない）
                if (lp.firedRef.current) {
                    lp.firedRef.current = false;
                    e.stopPropagation();
                    return;
                }
                onClick(e);
            }}
            className={`${CARD_BASE_CLASS} ${isMovingSource ? 'ring-2 ring-slate-700 ring-offset-1' : ''}`}
            style={{
                backgroundColor: event.color,
                ...(event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : {}),
            }}
        >
            <FloatingCardBody event={event} compact={compact} />
        </button>
    );
}

interface FloatingDraggableCardProps extends FloatingCardCommonProps {
    /** 移動モード中は D&D を止め、タップ＝移動先確定として扱う */
    draggableDisabled: boolean;
}

/**
 * enableDrag=true 時（PC）の浮きカード。dnd-kit の useDraggable で職長セル/別日の浮きセルへ
 * ドラッグできる（useDraggable は DndContext 内でしか使えないため子コンポーネントに切り出す）。
 * id はイベントID。ドラッグ中は opacity を落とす（DragOverlay 側にプレビューが出る）。
 * PointerSensor の distance=8 制約により、クリック（昇格モーダル）とドラッグは両立する。
 */
function FloatingDraggableCard({ event, compact, isMovingSource, draggableDisabled, onClick, onLongPress }: FloatingDraggableCardProps) {
    const lp = useLongPress(onLongPress);
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: event.id,
        disabled: draggableDisabled,
    });
    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...(draggableDisabled ? {} : listeners)}
            // 長押しは capture フェーズで拾い、dnd-kit の（バブルフェーズ）listeners と両立させる
            onPointerDownCapture={lp.onPointerDown}
            onPointerMoveCapture={lp.onPointerMove}
            onPointerUpCapture={lp.onPointerEnd}
            onPointerCancelCapture={lp.onPointerEnd}
            onClick={(e) => {
                if (lp.firedRef.current) {
                    lp.firedRef.current = false;
                    e.stopPropagation();
                    return;
                }
                if (isDragging) return;
                onClick(e);
            }}
            className={`${CARD_BASE_CLASS} ${draggableDisabled ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-40' : ''} ${isMovingSource ? 'ring-2 ring-slate-700 ring-offset-1' : ''}`}
            style={{
                backgroundColor: event.color,
                ...(event.dateStatus === 'tentative' ? { backgroundImage: TENTATIVE_STRIPE_BG } : {}),
            }}
        >
            <FloatingCardBody event={event} compact={compact} />
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
 *
 * カード自体を移動できる（enableDrag=PC の D&D／onLongPressEvent=長押し→移動先タップ）:
 * - 浮きカード → 浮きレーンの別日セル = 浮きのまま日付だけ移動
 * - 浮きカード → 職長行のセル = 昇格（既存の通常移動フロー=車両確認モーダル経由）
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
    enableDrag = false,
    onLongPressEvent,
    movingEventId = null,
    isMoving = false,
    onCommitMove,
    onMoveLane,
    canMoveUp = true,
    canMoveDown = true,
}: FloatingLaneProps) {
    const floating = events.filter((e) => e.assignedEmployeeId === 'unassigned');

    return (
        <div className={`flex border-t-2 border-b-2 border-red-200 bg-red-50/40 ${compact ? 'min-h-[44px]' : 'min-h-[56px]'}`}>
            {/* 左固定ラベル（職長列と同じ幅） */}
            <div className="sticky left-0 z-10 bg-red-50 border-r-2 border-red-200 shadow-sm flex-shrink-0" style={labelWidth ? { width: labelWidth } : undefined}>
                <div className={`${labelWidth ? 'w-full' : compact ? 'w-14' : 'w-20 lg:w-24 xl:w-32'} h-full flex flex-col items-center justify-center px-1 relative group`}>
                    <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-red-700 tracking-wide`}>浮いている</span>
                    <span className="text-[9px] text-red-400">班未定</span>
                    {/* レーンの上下移動（職長行の▲▼と同じ位置・同じ見た目） */}
                    {onMoveLane && (
                        <div className="absolute right-0 top-0 flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                            {canMoveUp && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onMoveLane('up'); }}
                                    className="p-0.5 hover:bg-red-100 rounded transition-colors"
                                    title="上へ移動"
                                    aria-label="浮いているレーンを上へ移動"
                                >
                                    <ChevronUp className="w-3 h-3 text-red-600" />
                                </button>
                            )}
                            {canMoveDown && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onMoveLane('down'); }}
                                    className="p-0.5 hover:bg-red-100 rounded transition-colors"
                                    title="下へ移動"
                                    aria-label="浮いているレーンを下へ移動"
                                >
                                    <ChevronDown className="w-3 h-3 text-red-600" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {weekDays.map((day, index) => {
                const dateKey = formatDateKey(day.date);
                const dayFloating = floating
                    .filter((e) => formatDateKey(e.startDate) === dateKey)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

                // 移動モード中はセル/カードのタップで commitMove、それ以外は通常の onCellClick/onEventClick
                const interactive = (!isReadOnly && !!onCellClick) || (isMoving && !!onCommitMove);
                // relative: 浮きメモの鉛筆（CellRemarkInput floatingLane）をセル基準で右下に絶対配置するため
                const cellClassName = `relative ${colWidth ? 'grow flex-shrink-0' : `flex-1 ${compact ? 'min-w-[72px]' : 'min-w-[84px]'}`} border-r border-red-100 p-1 ${
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
                        {dayFloating.map((event) => {
                            const isMovingSource = movingEventId === event.id;
                            const handleCardClick = (e: React.MouseEvent) => {
                                e.stopPropagation();
                                if (isMoving && onCommitMove) {
                                    // 移動モード中はカードのタップも「この日へ確定」。移動元カード自身は
                                    // 同日 no-op ガード（handleMoveToCell）で実害なし
                                    onCommitMove(day.date);
                                    return;
                                }
                                onEventClick?.(event.id);
                            };
                            // 移動モード中はこのカード自体が「移動先確定」のタップ対象になるので長押しは無効化
                            const longPress = !isMoving && onLongPressEvent ? () => onLongPressEvent(event) : undefined;

                            return enableDrag && !isReadOnly ? (
                                <FloatingDraggableCard
                                    key={event.id}
                                    event={event}
                                    compact={compact}
                                    isMovingSource={isMovingSource}
                                    draggableDisabled={isMoving}
                                    onClick={handleCardClick}
                                    onLongPress={longPress}
                                />
                            ) : (
                                <FloatingPlainCard
                                    key={event.id}
                                    event={event}
                                    compact={compact}
                                    isMovingSource={isMovingSource}
                                    onClick={handleCardClick}
                                    onLongPress={longPress}
                                />
                            );
                        })}
                        {/* 移動モード中: この日を移動先候補として点線ターゲットで示す（職長セルと同系統・赤） */}
                        {isMoving && onCommitMove && (
                            <div className={`pointer-events-none flex items-center justify-center ${compact ? 'min-h-[28px]' : 'min-h-[32px]'} my-1 border border-dashed border-red-400 text-red-400 rounded`}>
                                <Plus className="w-4 h-4" />
                            </div>
                        )}
                        {/* 空セルの新規登録動線（移動モード中はターゲットを優先して隠す） */}
                        {/* h-full は付けないこと: 伸びたセル高さの100%を取り直すため、
                            メモがあるとその分だけセル下枠へはみ出す（2026-07-21の実害） */}
                        {dayFloating.length === 0 && !isMoving && !isReadOnly && onCellClick && (
                            <div className={`${compact ? 'min-h-[32px]' : 'min-h-[40px]'} flex items-center justify-center text-red-200`}>
                                <Plus className="w-3.5 h-3.5" />
                            </div>
                        )}
                        {/* その日の浮きメモ（職長行のセルメモと同じ仕組み・foremanId='unassigned'）。
                            CellRemarkInput は data-cell-remark 内で stopPropagation するため、
                            メモ操作が浮きの新規登録クリック（handleCellClick）に化けない。
                            floatingLane: 鉛筆を右下に絶対配置し、はみ出し・点滅を防ぐ */}
                        <CellRemarkInput foremanId="unassigned" dateKey={dateKey} isReadOnly={isReadOnly} floatingLane />
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
