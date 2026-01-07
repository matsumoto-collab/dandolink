import {
    hasPermission,
    canAccessProject,
    isAdmin,
    canManageUsers,
    getRoleDisplayName,
} from '@/utils/permissions';
import { User } from '@/types/user';

describe('permissions', () => {
    // テスト用ユーザーデータ
    const createUser = (role: string, isActive: boolean = true, assignedProjects?: string[]): User => ({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
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

            it('should not have permissions on users', () => {
                expect(hasPermission(manager, 'users', 'view')).toBe(false);
                expect(hasPermission(manager, 'users', 'create')).toBe(false);
            });
        });

        describe('foreman1 role', () => {
            const foreman1 = createUser('foreman1');

            it('should have view and edit permissions on projects', () => {
                expect(hasPermission(foreman1, 'projects', 'view')).toBe(true);
                expect(hasPermission(foreman1, 'projects', 'edit')).toBe(true);
                expect(hasPermission(foreman1, 'projects', 'create')).toBe(false);
                expect(hasPermission(foreman1, 'projects', 'delete')).toBe(false);
            });

            it('should have view and edit permissions on assignments', () => {
                expect(hasPermission(foreman1, 'assignments', 'view')).toBe(true);
                expect(hasPermission(foreman1, 'assignments', 'edit')).toBe(true);
            });
        });

        describe('foreman2 role', () => {
            const foreman2 = createUser('foreman2');

            it('should have view and edit permissions on projects', () => {
                expect(hasPermission(foreman2, 'projects', 'view')).toBe(true);
                expect(hasPermission(foreman2, 'projects', 'edit')).toBe(true);
            });

            it('should have view and edit permissions on assignments', () => {
                expect(hasPermission(foreman2, 'assignments', 'view')).toBe(true);
                expect(hasPermission(foreman2, 'assignments', 'edit')).toBe(true);
            });
        });

        describe('worker role', () => {
            const worker = createUser('worker');

            it('should only have view permissions on projects', () => {
                expect(hasPermission(worker, 'projects', 'view')).toBe(true);
                expect(hasPermission(worker, 'projects', 'edit')).toBe(false);
                expect(hasPermission(worker, 'projects', 'create')).toBe(false);
            });

            it('should only have view permissions on assignments', () => {
                expect(hasPermission(worker, 'assignments', 'view')).toBe(true);
                expect(hasPermission(worker, 'assignments', 'edit')).toBe(false);
            });
        });
    });

    describe('canAccessProject', () => {
        const projectId = 'project-123';

        it('should return false for null user', () => {
            expect(canAccessProject(null, projectId)).toBe(false);
        });

        it('should return false for inactive user', () => {
            const inactiveAdmin = createUser('admin', false);
            expect(canAccessProject(inactiveAdmin, projectId)).toBe(false);
        });

        it('should return true for admin', () => {
            const admin = createUser('admin');
            expect(canAccessProject(admin, projectId)).toBe(true);
        });

        it('should return true for manager', () => {
            const manager = createUser('manager');
            expect(canAccessProject(manager, projectId)).toBe(true);
        });

        it('should return true for foreman1', () => {
            const foreman1 = createUser('foreman1');
            expect(canAccessProject(foreman1, projectId)).toBe(true);
        });

        it('should return true for foreman2 with assigned project', () => {
            const foreman2 = createUser('foreman2', true, [projectId]);
            expect(canAccessProject(foreman2, projectId)).toBe(true);
        });

        it('should return false for foreman2 without assigned project', () => {
            const foreman2 = createUser('foreman2', true, ['other-project']);
            expect(canAccessProject(foreman2, projectId)).toBe(false);
        });

        it('should return true for worker with assigned project', () => {
            const worker = createUser('worker', true, [projectId]);
            expect(canAccessProject(worker, projectId)).toBe(true);
        });

        it('should return false for worker without assigned project', () => {
            const worker = createUser('worker', true, ['other-project']);
            expect(canAccessProject(worker, projectId)).toBe(false);
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

        it('should return false for manager', () => {
            const manager = createUser('manager');
            expect(isAdmin(manager)).toBe(false);
        });
    });

    describe('canManageUsers', () => {
        it('should return true for admin', () => {
            const admin = createUser('admin');
            expect(canManageUsers(admin)).toBe(true);
        });

        it('should return false for non-admin roles', () => {
            expect(canManageUsers(createUser('manager'))).toBe(false);
            expect(canManageUsers(createUser('foreman1'))).toBe(false);
            expect(canManageUsers(createUser('foreman2'))).toBe(false);
            expect(canManageUsers(createUser('worker'))).toBe(false);
        });
    });

    describe('getRoleDisplayName', () => {
        it('should return correct display names for all roles', () => {
            expect(getRoleDisplayName('admin')).toBe('管理者');
            expect(getRoleDisplayName('manager')).toBe('マネージャー');
            expect(getRoleDisplayName('foreman1')).toBe('職長1');
            expect(getRoleDisplayName('foreman2')).toBe('職長2');
            expect(getRoleDisplayName('worker')).toBe('職方');
        });

        it('should return role string for unknown role', () => {
            expect(getRoleDisplayName('unknown')).toBe('unknown');
        });
    });
});
