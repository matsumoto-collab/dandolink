export type UserRole = 'admin' | 'manager' | 'foreman1' | 'foreman2' | 'worker';

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
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface UserWithPassword extends User {
    passwordHash: string;
}
