// 領収書・レシートの型。API レスポンスに対応。
// Decimal 系は Prisma が JSON で文字列にすることがあるため number | string を許容する（表示・集計は Number() を通す）。

// 参照型（旧 types/purchaseInvoice.ts から移設。仕入請求書機能の撤去後も領収書で使用）
export interface ExpenseCategoryRef {
    id: string;
    name: string;
    costBucket: string;
}

export interface ProjectMasterRef {
    id: string;
    title: string;
    name: string | null;
}

// AI抽出の生データ（extractedData に保持）。摘要ヒント表示などに使う。
export interface ReceiptExtractedData {
    storeName: string | null;
    issueDate: string | null;
    totalAmount: number | null;
    taxAmount: number | null;
    summary: string | null;
    suggestedCategory: string | null;
}

// 支払方法。UI の select と PATCH バリデーションで共用。
export const PAYMENT_METHODS = ['cash', 'company_card', 'personal'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    cash: '現金',
    company_card: '会社カード',
    personal: '個人立替',
};

export interface Receipt {
    id: string;
    status: string; // 'pending' | 'confirmed'
    fileName: string;
    mimeType: string;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    extractedData: ReceiptExtractedData | null;
    storeName: string | null;
    issueDate: string | null;
    totalAmount: number | string | null;
    taxAmount: number | string | null;
    expenseCategoryId: string | null;
    projectMasterId: string | null;
    paymentMethod: string | null; // PaymentMethod | null
    paidBy: string | null;
    notes: string | null;
    settled: boolean; // 精算済み（立替者への支払い完了）
    settledAt: string | null;
    confirmedAt: string | null;
    createdAt: string;
    expenseCategory: ExpenseCategoryRef | null;
    projectMaster: ProjectMasterRef | null;
}
