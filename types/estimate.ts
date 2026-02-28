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
    createdAt: Date;
    updatedAt: Date;
}

// 見積書作成時の入力データ
export type EstimateInput = Omit<Estimate, 'id' | 'createdAt' | 'updatedAt'>;
