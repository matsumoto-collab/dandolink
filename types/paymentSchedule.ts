// 支払予定の型定義
import type { Payee, AccountType } from './payee';

export type PaymentType = 'transfer' | 'payment_slip'; // 振込 | 払込用紙

export interface PaymentSchedule {
    id: string;
    paymentDate: string;             // ISO日付文字列（フロントでは文字列として扱う）
    paymentType: PaymentType;
    payeeId?: string | null;         // 振込先マスターのID
    payeeName: string;               // 振込先名のスナップショット
    amount: number | string;         // Decimal は文字列または数値で返ってくる
    feeFlag: boolean;                // 当社が手数料負担するか
    dueDate?: string | null;         // 払込期日（払込用紙用）
    bankName?: string | null;
    branchName?: string | null;
    accountType?: AccountType | null;
    accountNumber?: string | null;
    accountHolder?: string | null;
    isPaid: boolean;
    paidAt?: string | null;
    paidBy?: string | null;
    notes?: string | null;
    sortOrder: number;
    listKey?: string | null;         // 同一支払日内でリストを分けるグループキー（null=旧データは日付単位で1リスト）
    createdAt: string;
    updatedAt: string;
    updatedBy?: string | null;
    payee?: Payee | null;            // include した時のみ
}

// 支払予定の作成・更新時の入力データ
export interface PaymentScheduleInput {
    paymentDate: string;             // YYYY-MM-DD
    paymentType: PaymentType;
    payeeId?: string | null;
    payeeName: string;
    amount: number;
    feeFlag?: boolean;
    dueDate?: string | null;
    bankName?: string | null;
    branchName?: string | null;
    accountType?: AccountType | null;
    accountNumber?: string | null;
    accountHolder?: string | null;
    isPaid?: boolean;
    notes?: string | null;
    sortOrder?: number;
    listKey?: string | null;
}
