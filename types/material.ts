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
    items: MaterialItemWithStock[];
}

// 在庫数付き材料品目
export interface MaterialItemWithStock extends MaterialItem {
    stockQuantity: number;
}

// 在庫取引履歴
export interface InventoryTransaction {
    id: string;
    materialItemId: string;
    quantity: number;
    type: 'initial' | 'dispatch' | 'return' | 'adjustment';
    referenceId: string | null;
    referenceType: string | null;
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    materialItem?: MaterialItem;
}

// 案件別材料表
export interface ProjectMaterialItem {
    id: string;
    projectMasterId: string;
    materialItemId: string;
    requiredQuantity: number;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    materialItem?: MaterialItem;
}

// 積込リスト
export interface LoadingListResponse {
    date: string;
    vehicleId: string;
    vehicleName: string;
    projects: { id: string; title: string }[];
    items: LoadingListItem[];
}

export interface LoadingListItem {
    materialItemId: string;
    categoryName: string;
    materialName: string;
    spec: string | null;
    unit: string;
    totalQuantity: number;
    isChecked: boolean;
    checkedBy: string | null;
    breakdown: LoadingListBreakdown[];
}

export interface LoadingListBreakdown {
    projectMasterId: string;
    projectTitle: string;
    quantity: number;
    isChecked: boolean;
}
