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
