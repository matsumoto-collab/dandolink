// プロジェクトステータス型
export type ProjectStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

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
    status?: ProjectStatus;
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

// ===== 新データモデル =====

// 工事内容タイプ
export type ConstructionContentType = 'new_construction' | 'renovation' | 'large_scale' | 'other';

export const CONSTRUCTION_CONTENT_LABELS: Record<ConstructionContentType, string> = {
    new_construction: '新築',
    renovation: '改修',
    large_scale: '大規模',
    other: 'その他',
};

// 足場仕様インターフェース
export interface ScaffoldingSpec {
    // 項目1
    singleSideScaffold: boolean;  // 一側足場
    mainScaffold: boolean;        // 本足場
    outerHandrail: '1本' | '2本' | null; // 外手摺
    innerHandrail: string;        // 内手摺（本数）
    fallPreventionHandrail: '1本' | '2本' | '3本' | null; // 落下防止手摺
    baseboard: 'L型' | '木' | null; // 巾木
    narrowNet: boolean;           // 小幅ネット
    wallTie: string;              // 壁つなぎ

    // 項目2
    sheet: boolean;               // シート
    sheetType: string;            // シート種別※カヤシートの場合
    imageSheet: '持参' | '現場' | null; // イメージシート
    scaffoldSign: boolean;        // 足場表示看板
    stairs: boolean;              // 階段
    ladder: boolean;              // タラップ
    stairUnit: boolean;           // 階段墜
    cornerAnti: '400' | '250' | null; // 1・2コマアンチ

    // 項目3
    parentRope: string;           // 親綱
    cushionCover: boolean;        // 養生カバークッション
    spaceTube: boolean;           // スペースチューブ
    gableHandrail: boolean;       // 切妻単管手摺
}

// デフォルト足場仕様
export const DEFAULT_SCAFFOLDING_SPEC: ScaffoldingSpec = {
    singleSideScaffold: false,
    mainScaffold: false,
    outerHandrail: null,
    innerHandrail: '',
    fallPreventionHandrail: null,
    baseboard: null,
    narrowNet: false,
    wallTie: '',
    sheet: false,
    sheetType: '',
    imageSheet: null,
    scaffoldSign: false,
    stairs: false,
    ladder: false,
    stairUnit: false,
    cornerAnti: null,
    parentRope: '',
    cushionCover: false,
    spaceTube: false,
    gableHandrail: false,
};

// 案件マスター（1現場=1レコード）
export interface ProjectMaster {
    id: string;
    title: string;                   // 現場名
    customerId?: string;             // 顧客ID
    customerName?: string;           // 顧客名（表示用）
    customerShortName?: string;      // 顧客略称（表示用）
    constructionType: ConstructionType; // 工事種別（カレンダー登録時に設定）
    constructionContent?: ConstructionContentType; // 工事内容
    status: 'active' | 'completed' | 'cancelled';

    // 住所情報
    location?: string;               // その他住所
    postalCode?: string;             // 郵便番号
    prefecture?: string;             // 都道府県
    city?: string;                   // 市区町村
    plusCode?: string;               // Plus Code/座標

    // 工事情報
    area?: number;                   // 面積（m2）
    areaRemarks?: string;            // 面積備考
    assemblyDate?: Date;             // 組立日
    demolitionDate?: Date;           // 解体日
    estimatedAssemblyWorkers?: number;   // 予定組立人工
    estimatedDemolitionWorkers?: number; // 予定解体人工
    contractAmount?: number;         // 請負金額（円、税抜）

    // 足場仕様
    scaffoldingSpec?: ScaffoldingSpec;

    description?: string;            // 説明
    remarks?: string;                // 備考
    createdBy?: string | string[];   // 案件担当者
    createdAt: Date;
    updatedAt: Date;
    // リレーション（optional）
    assignments?: ProjectAssignment[];
}

// 案件配置（班・日付への割り当て）
export interface ProjectAssignment {
    id: string;
    projectMasterId: string; // 案件マスターへの参照
    projectMaster?: ProjectMaster; // リレーション（optional）

    assignedEmployeeId: string; // 担当職長ID
    date: Date;              // 作業日
    memberCount: number;     // 人数
    workers?: string[];      // 職方ID配列
    vehicles?: string[];     // 車両ID配列
    meetingTime?: string;    // 集合時間（例: "08:00"）
    sortOrder: number;       // カレンダー内での表示順序
    remarks?: string;        // 配置固有の備考
    constructionType?: ConstructionType; // 配置ごとの工事種別（nullの場合はProjectMasterから継承）

    // 手配確定フィールド
    confirmedWorkerIds?: string[];  // 確定職方ID配列
    confirmedVehicleIds?: string[]; // 確定車両ID配列
    isDispatchConfirmed: boolean;   // 手配確定フラグ

    createdAt: Date;
    updatedAt: Date;
}

// カレンダー表示用：ProjectAssignmentからCalendarEventへの変換時の型
export interface AssignmentCalendarEvent extends CalendarEvent {
    projectMasterId: string;
    assignmentId: string;
    memberCount: number;
    confirmedWorkerIds?: string[];
    confirmedVehicleIds?: string[];
    isDispatchConfirmed: boolean;
}

// ===== 後方互換用（非推奨） =====

/**
 * @deprecated Use ProjectMaster + ProjectAssignment instead
 * 旧システム互換用。新規開発では使用しないでください。
 */
export interface Project extends CalendarEvent {
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string | string[];
    sortOrder?: number;
    assemblyDuration?: number;
    demolitionDuration?: number;
    vehicles?: string[];
    meetingTime?: string;
    workSchedules?: WorkSchedule[];
    projectMasterId?: string;
    assignmentId?: string;
    confirmedForemanId?: string;
    confirmedWorkerIds?: string[];
    confirmedVehicleIds?: string[];
    isDispatchConfirmed?: boolean;
    constructionContent?: ConstructionContentType; // 工事内容（案件マスターから連携）
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
export type ViewType = 'calendar';

// カラーパレット（プレミアム・モダンデザイン）
export const CALENDAR_COLORS = {
    // Deep Azure Blue - 高級感のあるディープブルー
    primary: '#4f7cac',
    // Sophisticated Teal - 洗練されたティール
    secondary: '#5aa9a0',
    // Premium Green - 落ち着いたグリーン
    success: '#6b9e78',
    // Warm Gold - 上品なゴールド
    warning: '#d4a84b',
    // Elegant Rose - エレガントなローズ
    danger: '#c97878',
    // Slate Blue - クールなスレートブルー
    info: '#7089a8',
    // Warm Gray - 温かみのあるグレー
    light: '#a8a8a8',
    // Deep Navy - ディープネイビー
    dark: '#4a5568',
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

// 工事種別別のカラー（プレミアム版）
export const CONSTRUCTION_TYPE_COLORS: Record<ConstructionType, string> = {
    assembly: '#a8c8e8',    // 薄い青（Light Blue）
    demolition: '#f0a8a8',  // 薄い赤（Light Red/Pink）
    other: '#fef08a',       // 薄い黄色（Light Yellow）
};

// 工事種別のラベル
export const CONSTRUCTION_TYPE_LABELS: Record<ConstructionType, string> = {
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
};
