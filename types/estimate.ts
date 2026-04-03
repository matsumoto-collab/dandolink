// 見積書の明細項目
export interface EstimateItem {
    id: string;
    description: string;  // 品目・内容
    specification?: string; // 規格
    quantity: number;     // 数量
    unit?: string;        // 単位
    unitPrice: number;    // 単価
    amount: number;       // 金額
    taxType: 'none' | 'standard'; // 税区分（なし、10%）
    notes?: string;       // 備考
    costAmount?: number | null; // 原価金額（予算書用） - 自動計算: costQuantity * costUnitPrice
    costName?: string;          // 原価項目名（マスタから選択 or 自由入力）
    costQuantity?: number;      // 原価数量
    costUnit?: string;          // 原価単位
    costUnitPrice?: number;     // 原価単価
    isCategory?: boolean;       // カテゴリ行（子項目をグループ化）
    categoryType?: 'inline' | 'detail';  // inline=表紙展開, detail=内訳明細書（デフォルト: detail）
    children?: EstimateItem[];  // 子項目（isCategoryがtrueの場合）
}

// 見積書
export interface Estimate {
    id: string;
    projectId?: string;
    customerId?: string;
    estimateNumber: string;
    title: string;
    items: EstimateItem[];
    subtotal: number;
    tax: number;
    total: number;
    validUntil: Date;
    status: 'draft' | 'sent' | 'approved' | 'rejected';
    notes?: string;
    location?: string;
    costTotal?: number | null;
    constructionPeriod?: string | null;
    createdAt: Date;
    updatedAt: Date;
    updatedBy?: string;
}

// 見積書作成時の入力データ
export type EstimateInput = Omit<Estimate, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;
