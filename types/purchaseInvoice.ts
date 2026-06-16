// 仕入請求書（支払側の請求書）の型。API レスポンスに対応。
// Decimal 系は Prisma が JSON で文字列にすることがあるため number | string を許容する。

export interface PurchaseInvoiceItem {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | string | null;
    amount: number | string | null;
    sortOrder: number;
}

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

export interface PayeeRef {
    id: string;
    name: string;
    nameKana?: string | null;
    bankName?: string | null;
    branchName?: string | null;
    accountType?: string | null;
    accountNumber?: string | null;
    accountHolder?: string | null;
}

export interface PurchaseInvoice {
    id: string;
    status: string; // 'pending' | 'classified' | 'confirmed'
    fileName: string;
    mimeType: string;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    extractedData: unknown;
    payeeName: string | null;
    payeeId: string | null;
    payeeKana: string | null;
    bankName: string | null;
    branchName: string | null;
    accountType: string | null;
    accountNumber: string | null;
    accountHolder: string | null;
    issueDate: string | null;
    dueDate: string | null;
    totalAmount: number | string | null;
    taxAmount: number | string | null;
    projectMasterId: string | null;
    expenseCategoryId: string | null;
    notes: string | null;
    paymentScheduleId: string | null;
    createdAt: string;
    items: PurchaseInvoiceItem[];
    expenseCategory: ExpenseCategoryRef | null;
    projectMaster: ProjectMasterRef | null;
    payee: PayeeRef | null;
}
