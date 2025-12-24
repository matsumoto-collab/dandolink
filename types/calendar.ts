// カレンダーイベントの型定義
export interface CalendarEvent {
    id: string;
    title: string;
    startDate: Date;
    endDate?: Date;
    category: EventCategory;
    color: string;
    description?: string;
    location?: string;
    customer?: string;
    workers?: string[];
    trucks?: string[];
    remarks?: string;
    status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    constructionType?: ConstructionType; // 工事種別(後方互換性のため保持)
    // 班長割り当て用
    assignedEmployeeId?: string;
    // セル内での表示順序
    sortOrder?: number;
    // 組立・解体の日程(新規)
    assemblyStartDate?: Date;
    assemblyEndDate?: Date;
    demolitionStartDate?: Date;
    demolitionEndDate?: Date;
}

// イベントカテゴリー
export type EventCategory =
    | 'construction'  // 建設
    | 'maintenance'   // メンテナンス
    | 'meeting'       // 会議
    | 'delivery'      // 配送
    | 'inspection'    // 検査
    | 'other';        // その他

// 工事種別
export type ConstructionType =
    | 'assembly'      // 組立
    | 'demolition'    // 解体
    | 'other';        // その他

// 各日のスケジュール
export interface DailySchedule {
    date: Date;                    // 作業日
    assignedEmployeeId?: string;   // 担当職長
    memberCount: number;           // 人数
    workers?: string[];            // 作業員（詳細）
    trucks?: string[];             // 車両
    remarks?: string;              // 備考
    sortOrder?: number;            // カレンダー内での表示順序
}

// 作業スケジュール（組立、解体など）
export interface WorkSchedule {
    id: string;
    type: ConstructionType;        // 作業種別
    dailySchedules: DailySchedule[]; // 各日のスケジュール
}

// 案件型（CalendarEventを拡張）
export interface Project extends CalendarEvent {
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string | string[]; // 案件担当者（複数選択可能）
    sortOrder?: number; // セル内での表示順序

    // 複数日作業スケジュール（新システム）
    workSchedules?: WorkSchedule[];

    // 新しい案件マスター・割り当てシステムとの互換性
    projectMasterId?: string; // 案件マスターへの参照（新システム）
    assignmentId?: string;    // 案件割り当てへの参照（新システム）
}



// 班長の型定義
export interface Employee {
    id: string;
    name: string;
    nickname?: string;
    group?: string;
}

// 週の日付情報
export interface WeekDay {
    date: Date;
    dayOfWeek: number; // 0: 日曜, 1: 月曜, ..., 6: 土曜
    isToday: boolean;
    isWeekend: boolean;
    isHoliday: boolean;
    events: CalendarEvent[]; // その日のイベント配列
}

// 班長の行データ（1日に複数案件がある場合は複数行になる）
export interface EmployeeRow {
    employeeId: string;
    employeeName: string;
    rowIndex: number; // 同じ班長の何行目か（0始まり）
    events: Map<string, CalendarEvent[]>; // key: 日付文字列 (YYYY-MM-DD), value: その日のイベント配列
}

// カレンダービューの型
export type ViewType = 'gantt' | 'calendar';

// カラーパレット（段取太郎風）
export const CALENDAR_COLORS = {
    primary: '#abd1e8',
    secondary: '#9edbd6',
    success: '#a6e1b1',
    warning: '#eadb80',
    danger: '#e89e9f',
    info: '#acc6e9',
    light: '#cecece',
    dark: '#8094b7',
} as const;

// カテゴリー別のデフォルトカラー
export const CATEGORY_COLORS: Record<EventCategory, string> = {
    construction: CALENDAR_COLORS.primary,
    maintenance: CALENDAR_COLORS.secondary,
    meeting: CALENDAR_COLORS.info,
    delivery: CALENDAR_COLORS.warning,
    inspection: CALENDAR_COLORS.success,
    other: CALENDAR_COLORS.light,
};

// 工事種別別のカラー
export const CONSTRUCTION_TYPE_COLORS: Record<ConstructionType, string> = {
    assembly: '#3b82f6',    // 青 (blue-500)
    demolition: '#ef4444',  // 赤 (red-500)
    other: '#eab308',       // 黄色 (yellow-500)
};

// 工事種別のラベル
export const CONSTRUCTION_TYPE_LABELS: Record<ConstructionType, string> = {
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
};
