import { create } from 'zustand';
import type { ScheduleWatchNavItem } from '@/lib/scheduleWatchNav';

/** 週間カレンダーの特定日（と配置）へジャンプする依頼 */
export interface ScheduleJumpRequest {
    /** YYYY-MM-DD */
    date: string;
    assignmentId: string | null;
    /**
     * 「朝の見張りまとめ」通知から来たとき: 光らせて順にたどる配置の一覧と、今見る位置。
     * WeeklyCalendar はこれがあれば「見張りナビ」の帯を開く（date/assignmentId は items[index] と同じ）
     */
    watch?: { items: ScheduleWatchNavItem[]; index: number } | null;
    /** 同じ日付・配置を続けて要求されても再ジャンプするための使い捨て番号 */
    nonce: number;
}

interface ScheduleJumpState {
    request: ScheduleJumpRequest | null;
    /** ジャンプを依頼する。MainContent がスケジュール画面のカレンダー表示へ切り替え、WeeklyCalendar が消化する */
    requestJump: (
        date: string,
        assignmentId?: string | null,
        watch?: { items: ScheduleWatchNavItem[]; index: number } | null
    ) => void;
    /** WeeklyCalendar が消化したら呼ぶ */
    clearJump: () => void;
}

let nonceCounter = 0;

/**
 * チャットの「予定」→カレンダーへのジャンプなど、画面をまたぐジャンプ依頼の受け渡し。
 * URL パラメータ経由だと、掃除前と同じ URL を続けて push したときに useSearchParams が
 * 変わらず反応しない（2回目以降が無反応になる）ため、画面内の操作はこのストアで直接渡す。
 * URL は通知など外部からの入口だけに使い、MainContent がこのストアへ流し込む。
 */
export const useScheduleJumpStore = create<ScheduleJumpState>((set) => ({
    request: null,
    requestJump: (date, assignmentId = null, watch = null) =>
        set({ request: { date, assignmentId, watch, nonce: ++nonceCounter } }),
    clearJump: () => set({ request: null }),
}));
