export type UserRole = 'admin' | 'manager' | 'foreman1' | 'foreman2' | 'worker' | 'partner' | 'partner_member' | 'support';

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
    createdAt?: Date;
    updatedAt?: Date;
}

export interface UserWithPassword extends User {
    passwordHash: string;
}
