/**
 * 社内カレンダー（admin/manager 限定）の型定義
 */

/** イベントの種別 */
export const CALENDAR_CATEGORIES = [
    'site_survey',           // 現調
    'meeting',               // 打ち合わせ
    'road_permit_complete',  // 道路使用許可：完成日
    'road_permit_receive',   // 道路使用許可：受取日
    'road_permit_expiry',    // 道路使用許可：期限日
    'other',                 // その他
] as const;

export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

/** 種別ラベル（UI 表示用） */
export const CALENDAR_CATEGORY_LABELS: Record<CalendarCategory, string> = {
    site_survey: '現調',
    meeting: '打ち合わせ',
    road_permit_complete: '道路使用許可（完成日）',
    road_permit_receive: '道路使用許可（受取日）',
    road_permit_expiry: '道路使用許可（期限）',
    other: 'その他',
};

/** 種別の色（カレンダー上の色分け用） */
export const CALENDAR_CATEGORY_COLORS: Record<CalendarCategory, string> = {
    site_survey: '#3b82f6',          // blue
    meeting: '#10b981',              // green
    road_permit_complete: '#f97316', // orange
    road_permit_receive: '#eab308',  // yellow
    road_permit_expiry: '#ef4444',   // red
    other: '#64748b',                // slate
};

/** 公開範囲 */
export type CalendarVisibility = 'private' | 'shared';

/** API レスポンス上のイベント */
export interface CalendarEventDTO {
    id: string;
    title: string;
    description: string | null;
    category: CalendarCategory;
    startAt: string;   // ISO 文字列
    endAt: string;     // ISO 文字列
    allDay: boolean;
    location: string | null;
    visibility: CalendarVisibility;
    color: string | null;
    createdBy: string;
    createdByName?: string | null;
    projectMasterId: string | null;
    projectTitle?: string | null;
    customerId: string | null;
    createdAt: string;
    updatedAt: string;
    /** 自動生成（ProjectMaster の道路使用許可フィールド由来） */
    isAuto?: boolean;
}

/** イベント作成・更新リクエスト */
export interface CalendarEventInput {
    title: string;
    description?: string | null;
    category: CalendarCategory;
    startAt: string; // ISO 文字列
    endAt: string;   // ISO 文字列
    allDay?: boolean;
    location?: string | null;
    visibility?: CalendarVisibility;
    color?: string | null;
    projectMasterId?: string | null;
    customerId?: string | null;
}

export function isCalendarCategory(value: unknown): value is CalendarCategory {
    return typeof value === 'string' && (CALENDAR_CATEGORIES as readonly string[]).includes(value);
}

export function isCalendarVisibility(value: unknown): value is CalendarVisibility {
    return value === 'private' || value === 'shared';
}
