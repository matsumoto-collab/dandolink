// 振込先マスター（取引先の銀行口座台帳）の型定義
export type FeeBearer = 'us' | 'them';
export type AccountType = '普通' | '当座';

export interface Payee {
    id: string;
    name: string;              // 入金先名
    nameKana?: string | null;  // フリガナ
    alias?: string | null;     // 略称・別名
    feeBearer: FeeBearer;      // 手数料負担: 'us'=当社負担(●), 'them'=先方負担
    bankName?: string | null;
    branchName?: string | null;
    accountType?: AccountType | null;
    accountNumber?: string | null;
    accountHolder?: string | null;
    notes?: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    updatedBy?: string | null;
}

// 振込先作成・更新時の入力データ
export type PayeeInput = Omit<Payee, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'>;
