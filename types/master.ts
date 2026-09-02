import { ConstructionTypeMaster } from '@/types/calendar';

export interface Vehicle {
    id: string;
    name: string;
    dailyRate?: number | null; // 1日あたりの車両費（円）。未設定は null
}

/**
 * スケジュール（配置）で選ぶ電動工具。実体は機材台帳の Tool そのもの。
 * 車両は名前で配置に保存するが、工具は同じ名前の個体があり得るので ID で保存する。
 */
export interface ScheduleTool {
    id: string;
    name: string;
    categoryId: string;
    categoryName: string;
    categorySortOrder: number;
    /** in_stock | checked_out | repairing | lost | disposed（lib/equipment.ts の TOOL_STATUSES） */
    status: string;
    sortOrder: number;
    /** 台帳から外した工具は false。過去の配置の名前を出すために一覧には含める */
    isActive: boolean;
}

/** 電動工具の分類（機材台帳の ToolCategory）。設定画面のセレクト用。 */
export interface ToolCategoryOption {
    id: string;
    name: string;
    sortOrder: number;
}

export interface Manager {
    id: string;
    name: string;
}

export interface MemberCountHistoryEntry {
    id: string;
    startDate: string; // ISO date string
    count: number;
}

export interface MasterData {
    vehicles: Vehicle[];
    tools: ScheduleTool[];
    managers: Manager[];
    constructionTypes: ConstructionTypeMaster[];
    totalMembers: number;
    memberCountHistory: MemberCountHistoryEntry[];
}
