// 現金出納帳の型。API レスポンスに対応。
// Decimal 系は Prisma が JSON で文字列にすることがあるため number | string を許容する（表示・集計は Number() を通す）。

import type { ExpenseCategoryRef } from '@/types/receipt';

// 入金/出金の区分。UI の表示と API バリデーションで共用。
export const CASHBOOK_ENTRY_TYPES = ['in', 'out'] as const;
export type CashbookEntryType = (typeof CASHBOOK_ENTRY_TYPES)[number];

export interface CashbookEntry {
    id: string;
    seq: number;
    date: string;
    entryType: CashbookEntryType;
    description: string | null;
    amount: number | string;
    expenseCategoryId: string | null;
    expenseCategory: ExpenseCategoryRef | null;
    /** 清算日（実際に現金が動いた日・任意）。月別表示と残高計算は settledAt ?? date 基準 */
    settledAt: string | null;
    /** 精算方法。'cash'(現金) | 'transfer'(振込)。null=現金扱い。振込精算は現金残高の計算から除外 */
    settleMethod: 'cash' | 'transfer' | null;
    /** 申請者（氏名・自由入力） */
    applicantName: string | null;
    /** 同一表示日内の手動並び順（null は seq 順） */
    sortOrder: number | string | null;
    fileName: string | null;
    mimeType: string | null;
    sourceType: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    createdAt: string;
}

export interface CashbookListResponse {
    openingBalance: number;
    entries: CashbookEntry[];
}
