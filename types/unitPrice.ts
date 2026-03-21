// 単価マスターの型定義

// テンプレート（DB管理、自由登録）
export interface UnitPriceTemplate {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export type UnitPriceTemplateInput = Pick<UnitPriceTemplate, 'name' | 'sortOrder'>;

// カテゴリ（DB管理、自由登録）
export interface UnitPriceCategory {
    id: string;
    name: string;
    quantity?: number;
    unit?: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export type UnitPriceCategoryInput = Pick<UnitPriceCategory, 'name' | 'sortOrder'> & { quantity?: number; unit?: string };

// 単価マスター
export interface UnitPriceMaster {
    id: string;
    description: string;    // 品目・内容
    unit: string;          // 単位（例: 式、m、個、日）
    quantity?: number;     // 数量
    unitPrice: number;     // 単価
    templates: string[];   // 所属するテンプレートID（複数可）
    categoryId?: string;   // カテゴリID
    notes?: string;        // 備考
    createdAt: Date;
    updatedAt: Date;
}

// 単価マスター作成時の入力データ
export type UnitPriceMasterInput = Omit<UnitPriceMaster, 'id' | 'createdAt' | 'updatedAt'>;

// 規格（単価マスターに紐づく）
export interface UnitPriceSpecification {
    id: string;
    unitPriceMasterId: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export type UnitPriceSpecificationInput = Pick<UnitPriceSpecification, 'unitPriceMasterId' | 'name' | 'sortOrder'>;

// 後方互換: 旧TemplateType（マイグレーション用）
export type LegacyTemplateType = 'frequent' | 'large' | 'medium' | 'residential';
export const LEGACY_TEMPLATE_NAMES: Record<LegacyTemplateType, string> = {
    frequent: 'よく使う項目',
    large: '大規模見積用',
    medium: '中規模見積用',
    residential: '住宅見積用',
};
