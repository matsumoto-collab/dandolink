// 材料カテゴリ
export interface MaterialCategory {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    items?: MaterialItem[];
}

// 材料品目
export interface MaterialItem {
    id: string;
    categoryId: string;
    name: string;
    spec: string | null;
    unit: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

// 材料出庫伝票
export interface MaterialRequisition {
    id: string;
    projectMasterId: string;
    date: string;
    foremanId: string;
    foremanName: string;
    type: '出庫' | '返却';
    status: 'draft' | 'confirmed' | 'loaded';
    vehicleInfo: string | null;
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    items?: MaterialRequisitionItem[];
    // Joined fields
    projectTitle?: string;
}

// 出庫伝票明細
export interface MaterialRequisitionItem {
    id: string;
    requisitionId: string;
    materialItemId: string;
    quantity: number;
    vehicleLabel: string | null;
    notes: string | null;
    // Joined fields
    materialItem?: MaterialItem;
}

// 入力用
export interface MaterialRequisitionInput {
    projectMasterId: string;
    date: string;
    foremanId: string;
    foremanName: string;
    type: '出庫' | '返却';
    status: 'draft' | 'confirmed' | 'loaded';
    vehicleInfo?: string;
    notes?: string;
    items: MaterialRequisitionItemInput[];
}

export interface MaterialRequisitionItemInput {
    materialItemId: string;
    quantity: number;
    vehicleLabel?: string;
    notes?: string;
}

// カテゴリ付き品目（UI用）
export interface MaterialCategoryWithItems extends MaterialCategory {
    items: MaterialItem[];
}
