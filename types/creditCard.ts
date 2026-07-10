// クレジットカード明細・レシート受け箱の型。API レスポンスに対応。
// Decimal 系は Prisma が JSON で文字列にすることがあるため number | string を許容する（表示・集計は Number() を通す）。
import type { ExpenseCategoryRef, ReceiptExtractedData } from '@/types/receipt';

// 明細行の照合ステータス。UI のバッジと PATCH バリデーションで共用。
export const LINE_STATUSES = ['unmatched', 'matched', 'no_receipt'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
    unmatched: '未照合',
    matched: '照合済み',
    no_receipt: 'レシート不要',
};

// 明細書に紐付いた行から見えるレシート側の要約（受け箱一覧の「紐付け先」表示用）
export interface CardReceiptStatementRef {
    id: string;
    statementId: string;
    statement: {
        id: string;
        cardLabel: string;
        closingDate: string | null;
    } | null;
}

export interface CardReceipt {
    id: string;
    cardLabel: string | null;
    fileName: string;
    mimeType: string;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    extractedData: ReceiptExtractedData | null;
    storeName: string | null;
    issueDate: string | null;
    /// 金額の通貨コード（null=円）。例 'USD'。totalAmount/taxAmount はこの通貨の値のまま
    currency: string | null;
    totalAmount: number | string | null;
    taxAmount: number | string | null;
    expenseCategoryId: string | null;
    notes: string | null;
    applicantName: string | null;
    createdAt: string;
    expenseCategory: ExpenseCategoryRef | null;
    // 紐付け済みなら行への逆参照が載る（未紐付け = null）
    statementLine: CardReceiptStatementRef | null;
}

// AI抽出の検算メタ（CardStatement.extractedData に保持）
export interface CardStatementExtractMeta {
    reportedTotal: number | null; // 明細書フッタの「今月ご利用額合計」
    computedTotal: number | null; // 抽出した行合計（マイナス込み）
    lineCount: number;
}

export interface CardStatementLine {
    id: string;
    statementId: string;
    status: string; // LineStatus
    sortOrder: number;
    useDate: string;
    storeName: string;
    storeCategory: string | null;
    foreignAmount: number | string | null;
    currency: string | null;
    exchangeRate: number | string | null;
    amount: number | string;
    itemDetails: string | null;
    expenseCategoryId: string | null;
    notes: string | null;
    cardReceiptId: string | null;
    matchedAt: string | null;
    expenseCategory: ExpenseCategoryRef | null;
    cardReceipt: CardReceipt | null;
}

// 一覧用（行は進捗集計に必要な status のみ）
export interface CardStatementSummary {
    id: string;
    cardLabel: string;
    memberName: string | null;
    cardLast4: string | null;
    closingDate: string | null;
    totalAmount: number | string | null;
    extractedData: CardStatementExtractMeta | null;
    createdAt: string;
    lines: { status: string }[];
}

// 詳細用（全行 + 元ファイルの署名URL）
export interface CardStatement {
    id: string;
    cardLabel: string;
    memberName: string | null;
    cardLast4: string | null;
    closingDate: string | null;
    totalAmount: number | string | null;
    fileName: string;
    mimeType: string;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    extractedData: CardStatementExtractMeta | null;
    createdAt: string;
    lines: CardStatementLine[];
}
