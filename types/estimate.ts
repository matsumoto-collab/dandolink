// 見積書の明細項目
export interface EstimateItem {
    id: string;
    description: string;  // 品目・内容（名称）
    specification?: string; // 規格
    quantity: number;     // 数量
    unit?: string;        // 単位
    unitPrice: number;    // 単価
    amount: number;       // 金額
    taxType: 'none' | 'standard'; // 税区分（なし、10%）
    notes?: string;       // 備考
}

// 大項目カテゴリ（パターンB用）
export interface EstimateCategory {
    id: string;
    categoryName: string;   // 大項目名 (例: 外部足場, 仮囲い)
    categoryTotal: number;  // 大項目の合計金額
    items: EstimateItem[];  // 内訳明細
}

// 見積書
export interface Estimate {
    id: string;
    projectId?: string;
    customerId?: string;
    estimateNumber: string;
    title: string;
    items: EstimateItem[];
    categories?: EstimateCategory[]; // 大項目（パターンB用）
    isComplex?: boolean;             // true=パターンB(表紙+内訳明細書), false=パターンA(1枚完結)
    subtotal: number;
    tax: number;
    total: number;
    validUntil: Date;
    status: 'draft' | 'sent' | 'approved' | 'rejected';
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

// 見積書作成時の入力データ
export type EstimateInput = Omit<Estimate, 'id' | 'createdAt' | 'updatedAt'>;
