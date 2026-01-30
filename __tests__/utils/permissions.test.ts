jest.unmock('@/utils/permissions');

import {
    hasPermission,
    canAccessProject,
    isAdmin,
    canManageUsers,
    canDispatch,
    isManagerOrAbove,
    getRoleDisplayName,
} from '@/utils/permissions';

describe('permissions', () => {
    describe('hasPermission', () => {
        it('returns false for null/undefined user', () => {
            expect(hasPermission(null, 'projects', 'view')).toBe(false);
            expect(hasPermission(undefined, 'projects', 'view')).toBe(false);
        });

        it('returns false for inactive user', () => {
            expect(hasPermission({ role: 'admin', isActive: false }, 'projects', 'view')).toBe(false);
        });

        it('admin has full permissions', () => {
            const admin = { role: 'admin', isActive: true };
            expect(hasPermission(admin, 'projects', 'view')).toBe(true);
            expect(hasPermission(admin, 'projects', 'delete')).toBe(true);
            expect(hasPermission(admin, 'users', 'delete')).toBe(true);
        });

        it('worker has limited permissions', () => {
            const worker = { role: 'worker', isActive: true };
            expect(hasPermission(worker, 'projects', 'view')).toBe(true);
            expect(hasPermission(worker, 'projects', 'edit')).toBe(false);
            expect(hasPermission(worker, 'estimates', 'view')).toBe(false);
        });

        it('returns false for unknown role', () => {
            expect(hasPermission({ role: 'unknown', isActive: true }, 'projects', 'view')).toBe(false);
        });
    });

    describe('canAccessProject', () => {
        it('admin/manager/foreman1 can access any project', () => {
            expect(canAccessProject({ role: 'admin', isActive: true }, 'proj-1')).toBe(true);
            expect(canAccessProject({ role: 'manager', isActive: true }, 'proj-1')).toBe(true);
            expect(canAccessProject({ role: 'foreman1', isActive: true }, 'proj-1')).toBe(true);
        });

        it('worker needs assigned projects', () => {
            const worker = { role: 'worker', isActive: true, assignedProjects: ['proj-1', 'proj-2'] };
            expect(canAccessProject(worker, 'proj-1')).toBe(true);
            expect(canAccessProject(worker, 'proj-3')).toBe(false);
        });

        it('worker without assignedProjects returns false', () => {
            expect(canAccessProject({ role: 'worker', isActive: true }, 'proj-1')).toBe(false);
        });
    });

    describe('canDispatch', () => {
        it('admin/manager/foreman1 can dispatch', () => {
            expect(canDispatch({ role: 'admin', isActive: true })).toBe(true);
            expect(canDispatch({ role: 'manager', isActive: true })).toBe(true);
            expect(canDispatch({ role: 'foreman1', isActive: true })).toBe(true);
        });

        it('foreman2/worker cannot dispatch', () => {
            expect(canDispatch({ role: 'foreman2', isActive: true })).toBe(false);
            expect(canDispatch({ role: 'worker', isActive: true })).toBe(false);
        });
    });

    describe('isManagerOrAbove', () => {
        it('only admin and manager return true', () => {
            expect(isManagerOrAbove({ role: 'admin', isActive: true })).toBe(true);
            expect(isManagerOrAbove({ role: 'manager', isActive: true })).toBe(true);
            expect(isManagerOrAbove({ role: 'foreman1', isActive: true })).toBe(false);
        });
    });

    describe('isAdmin / canManageUsers', () => {
        it('only active admin returns true', () => {
            expect(isAdmin({ role: 'admin', isActive: true })).toBe(true);
            expect(isAdmin({ role: 'admin', isActive: false })).toBe(false);
            expect(isAdmin({ role: 'manager', isActive: true })).toBe(false);
            expect(canManageUsers({ role: 'admin', isActive: true })).toBe(true);
        });
    });

    describe('getRoleDisplayName', () => {
        it('returns Japanese role names', () => {
            expect(getRoleDisplayName('admin')).toBe('管理者');
            expect(getRoleDisplayName('manager')).toBe('マネージャー');
            expect(getRoleDisplayName('foreman1')).toBe('職長1');
            expect(getRoleDisplayName('foreman2')).toBe('職長2');
            expect(getRoleDisplayName('worker')).toBe('職方');
            expect(getRoleDisplayName('unknown')).toBe('unknown');
        });
    });
});
