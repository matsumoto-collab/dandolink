import { useState, useCallback, useRef } from 'react';
import { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import { CalendarEvent } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { arrayMove } from '@dnd-kit/sortable';

interface UseDragAndDropReturn {
    activeId: string | null;
    handleDragStart: (event: DragStartEvent) => void;
    handleDragEnd: (event: DragEndEvent) => void;
    handleDragOver: (event: DragOverEvent) => void;
    handleDragCancel: () => void;
    moveEvent: (eventId: string, newEmployeeId: string, newDate: Date) => void;
}

/**
 * セル間移動が発生したときに「まだ確定していない移動」として親へ通知するための情報。
 * 親（WeeklyCalendar）はこれを受けて確認モーダルを表示する。
 */
export interface PendingMove {
    eventId: string;
    fromEmployeeId: string;
    fromDate: Date;
    toEmployeeId: string;
    toDate: Date;
    currentTrucks: string[];
    currentMemberCount: number;
    // 確認モーダルのタイトル表示用。週またぎ移動では移動元がストアから退避され
    // projects.find で件名を解決できないため、掴んだイベントの件名を持ち回す。
    title?: string;
}

interface UseDragAndDropOptions {
    // 指定された場合、セル間移動は即時確定せず onPendingMove で親に委ねる。
    // 未指定の場合は従来どおり即時 moveEvent で確定する（後方互換）。
    onPendingMove?: (pending: PendingMove) => void;
}

/**
 * ドラッグ&ドロップのロジックを管理するカスタムフック
 */
export function useDragAndDrop(
    events: CalendarEvent[],
    onEventsChange: (events: CalendarEvent[]) => void,
    options?: UseDragAndDropOptions
): UseDragAndDropReturn {
    const [activeId, setActiveId] = useState<string | null>(null);

    // ドラッグ中の一時的なイベント状態を保持
    const pendingEventsRef = useRef<CalendarEvent[] | null>(null);

    // 最新のeventsを常に参照できるようにする
    const eventsRef = useRef(events);
    eventsRef.current = events;

    // onPendingMove を ref 経由で参照（コールバックの同一性を保ち再生成による
    // 無限ループ事故を避ける。このフックは識別子の安定性に敏感）
    const onPendingMoveRef = useRef(options?.onPendingMove);
    onPendingMoveRef.current = options?.onPendingMove;

    // イベントを移動（handleDragEndより前に定義）
    const moveEvent = useCallback((
        eventId: string,
        newEmployeeId: string,
        newDate: Date
    ) => {
        // 最新のeventsを使用
        const currentEvents = eventsRef.current;
        const newDateKey = formatDateKey(newDate);

        // 移動先セルの既存案件のsortOrderの最大値を取得
        const targetCellEvents = currentEvents.filter(e =>
            e.id !== eventId &&
            e.assignedEmployeeId === newEmployeeId &&
            formatDateKey(e.startDate) === newDateKey
        );
        const maxSortOrder = targetCellEvents.reduce(
            (max, e) => Math.max(max, e.sortOrder ?? 0),
            -1
        );
        const newSortOrder = maxSortOrder + 1;

        const updatedEvents = currentEvents.map(event => {
            if (event.id === eventId) {
                return {
                    ...event,
                    assignedEmployeeId: newEmployeeId,
                    startDate: newDate,
                    sortOrder: newSortOrder,
                };
            }
            return event;
        });

        onEventsChange(updatedEvents);
    }, [onEventsChange]);

    // ドラッグ開始
    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(event.active.id as string);
        pendingEventsRef.current = null;
    }, []);

    // ドラッグオーバー（セル内ソート用 - 状態を蓄積）
    const handleDragOver = useCallback((event: DragOverEvent) => {
        const { active, over } = event;

        if (!over || active.id === over.id) {
            return;
        }

        // 現在の状態を取得（ペンディング状態があればそれを使用）
        const currentEvents = pendingEventsRef.current || eventsRef.current;

        // 同じセル内でのソートかどうかを判定
        const activeEvent = currentEvents.find(e => e.id === active.id);
        const overEvent = currentEvents.find(e => e.id === over.id);

        if (!activeEvent || !overEvent) {
            return;
        }

        // 同じ社員、同じ日付の場合のみソート
        const activeDateKey = formatDateKey(activeEvent.startDate);
        const overDateKey = formatDateKey(overEvent.startDate);

        if (
            activeEvent.assignedEmployeeId === overEvent.assignedEmployeeId &&
            activeDateKey === overDateKey
        ) {
            // このセル内のイベントのみを取得
            const cellEvents = currentEvents.filter(e =>
                e.assignedEmployeeId === activeEvent.assignedEmployeeId &&
                formatDateKey(e.startDate) === activeDateKey
            ).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

            const oldIndex = cellEvents.findIndex(e => e.id === active.id);
            const newIndex = cellEvents.findIndex(e => e.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                // セル内のイベントを並び替え
                const reorderedCellEvents = arrayMove(cellEvents, oldIndex, newIndex);

                // 並び替えたセル内イベントのsortOrderを更新
                const cellEventIds = new Set(reorderedCellEvents.map(e => e.id));
                const updatedEvents = currentEvents.map(evt => {
                    if (cellEventIds.has(evt.id)) {
                        const newSortOrder = reorderedCellEvents.findIndex(e => e.id === evt.id);
                        return {
                            ...evt,
                            sortOrder: newSortOrder,
                        };
                    }
                    return evt;
                });

                // ペンディング状態を更新（UIは更新されるがサーバーにはまだ保存しない）
                pendingEventsRef.current = updatedEvents;
                // UIを更新
                onEventsChange(updatedEvents);
            }
        }
    }, [onEventsChange]);

    // ドラッグ終了（ドロップ）
    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        setActiveId(null);

        if (!over) {
            pendingEventsRef.current = null;
            return;
        }

        // over.idがイベントIDの場合（セル内ソート）とセルIDの場合（セル間移動）を区別
        const overEvent = eventsRef.current.find(e => e.id === over.id);

        if (overEvent) {
            // セル内ソートの場合: ペンディング状態があれば確定済み
            // handleDragOverですでにonEventsChangeが呼ばれている
            pendingEventsRef.current = null;
            return;
        }

        // セル間移動の処理
        // over.id の形式: "employeeId-date" (例: "user-123-2025-12-15")
        // NOTE: UUIDなどハイフンを含むIDに対応するため、末尾の日付(10文字)で分割
        const dropTargetId = over.id as string;
        const datePart = dropTargetId.slice(-10); // "YYYY-MM-DD"
        const newEmployeeId = dropTargetId.slice(0, -11); // "employeeId"
        const newDateStr = datePart;

        // イベントIDを取得
        const eventId = active.id as string;

        // 新しい日付を作成
        const [year, month, day] = newDateStr.split('-').map(Number);
        const newDate = new Date(Date.UTC(year, month - 1, day));

        // onPendingMove が渡されている場合は即時確定せず、確認モーダル用に親へ通知。
        // （未指定なら従来どおり即時移動）
        const onPendingMove = onPendingMoveRef.current;
        if (onPendingMove) {
            const movingEvent = eventsRef.current.find(e => e.id === eventId);
            if (movingEvent) {
                onPendingMove({
                    eventId,
                    fromEmployeeId: movingEvent.assignedEmployeeId ?? '',
                    fromDate: movingEvent.startDate,
                    toEmployeeId: newEmployeeId,
                    toDate: newDate,
                    currentTrucks: movingEvent.trucks ?? [],
                    currentMemberCount: movingEvent.memberCount ?? 0,
                    title: movingEvent.title,
                });
            }
            pendingEventsRef.current = null;
            return;
        }

        // イベントを移動
        moveEvent(eventId, newEmployeeId, newDate);
        pendingEventsRef.current = null;
    }, [moveEvent]);

    // ドラッグキャンセル
    const handleDragCancel = useCallback(() => {
        setActiveId(null);
        pendingEventsRef.current = null;
    }, []);

    return {
        activeId,
        handleDragStart,
        handleDragEnd,
        handleDragOver,
        handleDragCancel,
        moveEvent,
    };
}
