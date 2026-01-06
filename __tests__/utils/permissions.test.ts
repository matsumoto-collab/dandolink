import {
    hasPermission,
    canAccessProject,
    isAdmin,
    canManageUsers,
    getRolePermissions,
} from '@/utils/permissions';
import { User } from '@/types/user';

describe('permissions', () => {
    // テスト用ユーザーデータ
    const createUser = (role: string, isActive: boolean = true, assignedProjects?: string[]): User => ({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: role as User['role'],
        isActive,
        assignedProjects,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    describe('hasPermission', () => {
        it('should return false for null user', () => {
            expect(hasPermission(null, 'projects', 'view')).toBe(false);
        });

        it('should return false for undefined user', () => {
            expect(hasPermission(undefined, 'projects', 'view')).toBe(false);
        });

        it('should return false for inactive user', () => {
            const inactiveUser = createUser('admin', false);
            expect(hasPermission(inactiveUser, 'projects', 'view')).toBe(false);
        });

        describe('admin role', () => {
            const admin = createUser('admin');

            it('should have all permissions on projects', () => {
                expect(hasPermission(admin, 'projects', 'view')).toBe(true);
                expect(hasPermission(admin, 'projects', 'create')).toBe(true);
                expect(hasPermission(admin, 'projects', 'edit')).toBe(true);
                expect(hasPermission(admin, 'projects', 'delete')).toBe(true);
            });

            it('should have all permissions on users', () => {
                expect(hasPermission(admin, 'users', 'view')).toBe(true);
                expect(hasPermission(admin, 'users', 'create')).toBe(true);
                expect(hasPermission(admin, 'users', 'edit')).toBe(true);
                expect(hasPermission(admin, 'users', 'delete')).toBe(true);
            });
        });

        describe('manager role', () => {
            const manager = createUser('manager');

            it('should have full permissions on projects', () => {
                expect(hasPermission(manager, 'projects', 'view')).toBe(true);
                expect(hasPermission(manager, 'projects', 'create')).toBe(true);
                expect(hasPermission(manager, 'projects', 'edit')).toBe(true);
                expect(hasPermission(manager, 'projects', 'delete')).toBe(true);
            });

            it('should only have view permission on settings', () => {
                expect(hasPermission(manager, 'settings', 'view')).toBe(true);
                expect(hasPermission(manager, 'settings', 'edit')).toBe(false);
            });

            it('should have no permissions on users', () => {
                expect(hasPermission(manager, 'users', 'view')).toBe(false);
                expect(hasPermission(manager, 'users', 'create')).toBe(false);
            });
        });

        describe('user role', () => {
            const user = createUser('user');

            it('should have view and edit on projects', () => {
                expect(hasPermission(user, 'projects', 'view')).toBe(true);
                expect(hasPermission(user, 'projects', 'edit')).toBe(true);
                expect(hasPermission(user, 'projects', 'create')).toBe(false);
                expect(hasPermission(user, 'projects', 'delete')).toBe(false);
            });

            it('should have view only on invoices', () => {
                expect(hasPermission(user, 'invoices', 'view')).toBe(true);
                expect(hasPermission(user, 'invoices', 'create')).toBe(false);
            });

            it('should have no permissions on settings', () => {
                expect(hasPermission(user, 'settings', 'view')).toBe(false);
            });
        });

        describe('viewer role', () => {
            const viewer = createUser('viewer');

            it('should only have view permissions', () => {
                expect(hasPermission(viewer, 'projects', 'view')).toBe(true);
                expect(hasPermission(viewer, 'projects', 'edit')).toBe(false);
                expect(hasPermission(viewer, 'estimates', 'view')).toBe(true);
                expect(hasPermission(viewer, 'estimates', 'create')).toBe(false);
            });
        });
    });

    describe('canAccessProject', () => {
        it('should return false for null user', () => {
            expect(canAccessProject(null, 'project-1')).toBe(false);
        });

        it('should return false for inactive user', () => {
            const inactiveUser = createUser('admin', false);
            expect(canAccessProject(inactiveUser, 'project-1')).toBe(false);
        });

        it('should allow admin to access any project', () => {
            const admin = createUser('admin');
            expect(canAccessProject(admin, 'project-1')).toBe(true);
            expect(canAccessProject(admin, 'any-project')).toBe(true);
        });

        it('should allow manager to access any project', () => {
            const manager = createUser('manager');
            expect(canAccessProject(manager, 'project-1')).toBe(true);
        });

        it('should allow viewer to access any project', () => {
            const viewer = createUser('viewer');
            expect(canAccessProject(viewer, 'project-1')).toBe(true);
        });

        it('should allow user to access only assigned projects', () => {
            const user = createUser('user', true, ['project-1', 'project-2']);
            expect(canAccessProject(user, 'project-1')).toBe(true);
            expect(canAccessProject(user, 'project-2')).toBe(true);
            expect(canAccessProject(user, 'project-3')).toBe(false);
        });

        it('should deny user without assigned projects', () => {
            const user = createUser('user', true, undefined);
            expect(canAccessProject(user, 'project-1')).toBe(false);
        });
    });

    describe('isAdmin', () => {
        it('should return true for active admin', () => {
            const admin = createUser('admin');
            expect(isAdmin(admin)).toBe(true);
        });

        it('should return false for inactive admin', () => {
            const inactiveAdmin = createUser('admin', false);
            expect(isAdmin(inactiveAdmin)).toBe(false);
        });

        it('should return false for non-admin roles', () => {
            expect(isAdmin(createUser('manager'))).toBe(false);
            expect(isAdmin(createUser('user'))).toBe(false);
            expect(isAdmin(createUser('viewer'))).toBe(false);
        });

        it('should return false for null/undefined', () => {
            expect(isAdmin(null)).toBe(false);
            expect(isAdmin(undefined)).toBe(false);
        });
    });

    describe('canManageUsers', () => {
        it('should return true only for admin', () => {
            expect(canManageUsers(createUser('admin'))).toBe(true);
            expect(canManageUsers(createUser('manager'))).toBe(false);
            expect(canManageUsers(createUser('user'))).toBe(false);
            expect(canManageUsers(createUser('viewer'))).toBe(false);
        });
    });

    describe('getRolePermissions', () => {
        it('should return correct permissions for admin role', () => {
            const permissions = getRolePermissions('admin');
            expect(permissions.projects).toContain('view');
            expect(permissions.projects).toContain('create');
            expect(permissions.projects).toContain('edit');
            expect(permissions.projects).toContain('delete');
            expect(permissions.users).toContain('view');
        });

        it('should return correct permissions for viewer role', () => {
            const permissions = getRolePermissions('viewer');
            expect(permissions.projects).toContain('view');
            expect(permissions.projects).not.toContain('edit');
            expect(permissions.users).toHaveLength(0);
        });

        it('should return empty object for invalid role', () => {
            const permissions = getRolePermissions('invalid' as any);
            expect(permissions).toEqual({});
        });
    });
});
