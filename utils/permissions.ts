import { UserRole } from '@/types/user';

// Minimal user type for permission checks (compatible with NextAuth session.user)
interface PermissionUser {
    role: UserRole | string;
    isActive: boolean;
    assignedProjects?: string[];
}

// Role-based permissions configuration
const ROLE_PERMISSIONS = {
    admin: {
        projects: ['view', 'create', 'edit', 'delete'],
        estimates: ['view', 'create', 'edit', 'delete'],
        invoices: ['view', 'create', 'edit', 'delete'],
        customers: ['view', 'create', 'edit', 'delete'],
        settings: ['view', 'create', 'edit', 'delete'],
        users: ['view', 'create', 'edit', 'delete'],
        assignments: ['view', 'edit'],
    },
    manager: {
        projects: ['view', 'create', 'edit', 'delete'],
        estimates: ['view', 'create', 'edit', 'delete'],
        invoices: ['view', 'create', 'edit', 'delete'],
        customers: ['view', 'create', 'edit', 'delete'],
        settings: ['view'],
        users: [],
        assignments: ['view', 'edit'],
    },
    foreman1: {
        projects: ['view', 'edit'],
        estimates: ['view'],
        invoices: ['view'],
        customers: ['view'],
        settings: [],
        users: [],
        assignments: ['view', 'edit'], // 全班のメンバー・車両采配可能
    },
    foreman2: {
        projects: ['view', 'edit'], // 自班のみ
        estimates: ['view'],
        invoices: ['view'],
        customers: ['view'],
        settings: [],
        users: [],
        assignments: ['view', 'edit'], // 自班のみ操作可能
    },
    worker: {
        projects: ['view'], // 自班のみ
        estimates: [],
        invoices: [],
        customers: [],
        settings: [],
        users: [],
        assignments: ['view'], // 自班のみ表示
    },
} as const;

/**
 * Check if a user has permission to perform an action on a resource
 */
export function hasPermission(
    user: PermissionUser | null | undefined,
    resource: string,
    action: 'view' | 'create' | 'edit' | 'delete'
): boolean {
    if (!user || !user.isActive) return false;

    const rolePermissions = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS];
    if (!rolePermissions) return false;

    const resourcePermissions = rolePermissions[resource as keyof typeof rolePermissions] as readonly string[] | undefined;
    if (!resourcePermissions) return false;

    return resourcePermissions.includes(action);
}

/**
 * Check if a user can access a specific project
 */
export function canAccessProject(
    user: PermissionUser | null | undefined,
    projectId: string
): boolean {
    if (!user || !user.isActive) return false;

    // Admin and Manager can access all projects
    if (user.role === 'admin' || user.role === 'manager') return true;

    // Foreman1 can access all projects
    if (user.role === 'foreman1') return true;

    // Foreman2 and Worker need to check assigned projects
    if (user.role === 'foreman2' || user.role === 'worker') {
        if (!user.assignedProjects) return false;
        return user.assignedProjects.includes(projectId);
    }

    return false;
}

/**
 * Check if a user is an admin
 */
export function isAdmin(user: PermissionUser | null | undefined): boolean {
    return user?.role === 'admin' && user?.isActive === true;
}

/**
 * Check if a user can manage other users
 */
export function canManageUsers(user: PermissionUser | null | undefined): boolean {
    return user?.role === 'admin' && user?.isActive === true;
}

/**
 * Get role display name
 */
export function getRoleDisplayName(role: string): string {
    switch (role) {
        case 'admin':
            return '管理者';
        case 'manager':
            return 'マネージャー';
        case 'foreman1':
            return '職長1';
        case 'foreman2':
            return '職長2';
        case 'worker':
            return '職方';
        default:
            return role;
    }
}
