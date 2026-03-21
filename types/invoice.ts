import { EstimateItem } from './estimate';

// 請求項目マスター
export interface BillingTitle {
    id: string;
    name: string;
    quantity?: number;
    unit?: string;
    sortOrder: number;
    isActive: boolean;
}

// 請求書の明細項目（EstimateItemを拡張、案件グループ管理用）
export interface InvoiceItem extends EstimateItem {
    projectMasterId?: string; // どの案件に属する明細か
}

// 請求書
export interface Invoice {
    id: string;
    projectId?: string;       // レガシー互換（単一案件）
    customerId?: string;      // 顧客ID
    estimateId?: string;      // 見積書から変換した場合
    invoiceNumber: string;
    title: string;
    items: InvoiceItem[];
    subtotal: number;
    tax: number;
    total: number;
    dueDate: Date;
    status: 'draft' | 'sent' | 'paid' | 'overdue';
    paidDate?: Date;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
    // 複数案件対応
    projectMasterIds?: string[];
    projectMasters?: Array<{ id: string; title: string }>;
}

// 請求書作成時の入力データ
export type InvoiceInput = Omit<Invoice, 'id' | 'createdAt' | 'updatedAt'>;
