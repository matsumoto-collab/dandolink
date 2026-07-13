// 支払請求書の受け箱（支払予定への請求書AI取込）の型。API レスポンスに対応。
// Decimal 系は Prisma が JSON で文字列にすることがあるため number | string を許容する（表示・集計は Number() を通す）。
import type { Payee } from '@/types/payee';
import type { ExtractedSupplierInvoice } from '@/lib/supplierInvoiceExtract';

export interface SupplierInvoice {
    id: string;
    fileName: string;
    mimeType: string;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    extractedData: ExtractedSupplierInvoice | null;
    payeeName: string | null;
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
    registrationNumber: string | null;
    notes: string | null;
    payeeId: string | null;
    // 支払予定への追加済み参照（null=未追加。支払予定行を削除すると null に戻る）
    paymentScheduleId: string | null;
    createdAt: string;
    payee: Payee | null;
}
