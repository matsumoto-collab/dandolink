// 工具持出し管理の型定義（在庫管理メニュー内「持出しリスト」）

// 工具の状態。DB には文字列で保存する（Prisma enum は使わない = 既存モデルと同方針）
export const TOOL_STATUSES = ['in_stock', 'checked_out', 'repairing', 'lost', 'disposed'] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const TOOL_STATUS_LABELS: Record<ToolStatus, string> = {
    in_stock: '社内保管中',
    checked_out: '持出中',
    repairing: '修理中',
    lost: '紛失',
    disposed: '廃棄',
};

// 一覧の既定表示から外す状態（絞り込みで明示的に選んだときだけ出す）
export const TOOL_STATUSES_HIDDEN_BY_DEFAULT: ToolStatus[] = ['disposed'];

export const isToolStatus = (value: unknown): value is ToolStatus =>
    typeof value === 'string' && (TOOL_STATUSES as readonly string[]).includes(value);

// 工具の種類マスタ
export interface ToolCategory {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    // Joined fields
    toolCount?: number;
}

// 工具の個体（1台 = 1レコード）
export interface Tool {
    id: string;
    categoryId: string;
    name: string;
    status: ToolStatus;
    projectMasterId: string | null;
    destinationNote: string | null;
    holderId: string | null;
    checkedOutAt: string | null;
    note: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    // Joined fields（API がライブ解決して付与する。スナップショットではないので改名に追従する）
    categoryName?: string;
    projectName?: string;
    holderName?: string;
}

export type ToolLogAction = 'checkout' | 'return' | 'status_change';

// 持出し・返却・状態変更の履歴
export interface ToolCheckoutLog {
    id: string;
    toolId: string;
    action: ToolLogAction;
    status: ToolStatus;
    projectMasterId: string | null;
    projectName: string | null;
    destinationNote: string | null;
    holderId: string | null;
    holderName: string | null;
    note: string | null;
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
}

// 持出し/返却/状態変更のリクエストボディ
export interface ToolCheckoutRequest {
    status: ToolStatus;
    projectMasterId?: string | null;
    destinationNote?: string | null;
    holderId?: string | null;
    note?: string | null;
}

// 持出し先の表示名を組み立てる（案件名を優先し、無ければ自由入力欄）
export const formatToolDestination = (tool: Pick<Tool, 'projectName' | 'destinationNote'>): string =>
    tool.projectName || tool.destinationNote || '';
