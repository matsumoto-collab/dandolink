export type UserRole = 'admin' | 'manager' | 'accountant' | 'foreman1' | 'foreman2' | 'worker' | 'partner' | 'partner_member' | 'support';

export type PartnerTaxMode = 'exclusive' | 'inclusive';

export interface Permission {
    resource: string;
    actions: ('view' | 'create' | 'edit' | 'delete')[];
}

export interface User {
    id: string;
    username: string;
    displayName: string;
    email: string;
    role: UserRole;
    assignedProjects?: string[];
    dailyRate?: number;
    isActive: boolean;
    companyId?: string | null;
    isLoginEnabled?: boolean;
    /** role='partner' のときの請求税区分（税別/税込）。他ロールでは未使用 */
    partnerTaxMode?: PartnerTaxMode;
    /** 現金出納帳へのアクセス許可（ロールではなく個別ユーザー指定） */
    canAccessCashbook?: boolean;
    /** 仮予定の確認予定日の自動提案リード日数（予定日の◯日前）。初期14日 */
    tentativeConfirmLeadDays?: number;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface UserWithPassword extends User {
    passwordHash: string;
}
