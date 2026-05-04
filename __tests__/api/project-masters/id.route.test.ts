/**
 * @jest-environment node
 */
import { GET, PATCH, DELETE } from '@/app/api/project-masters/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canDispatch, isManagerOrAbove } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/project-masters/[id]', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };
    const mockContext = {
        params: Promise.resolve({ id: 'pm-1' })
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
        // getDocFlags が参照する count 系を 0 で固定
        (prisma.estimate.count as jest.Mock).mockResolvedValue(0);
        (prisma.invoice.count as jest.Mock).mockResolvedValue(0);
        (prisma as any).invoiceProjectMaster = {
            ...((prisma as any).invoiceProjectMaster || {}),
            count: jest.fn().mockResolvedValue(0),
        };
    });

    describe('GET', () => {
        it('should return project master', async () => {
            const mockProject = { id: 'pm-1', title: 'Test Project', createdAt: new Date() };
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(mockProject);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1');
            const res = await GET(req, mockContext);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.id).toBe('pm-1');
        });

        it('should return 404 if not found', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1');
            const res = await GET(req, mockContext);

            expect(res.status).toBe(404);
        });

        it('should return 401 if not authenticated', async () => {
            const errorRes = NextResponse.json({ error: 'Auth Required' }, { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1');
            const res = await GET(req, mockContext);

            expect(res.status).toBe(401);
        });
    });

    describe('PATCH', () => {
        const validBody = { title: 'Updated Title' };
        const existingProject = { id: 'pm-1', title: 'Old Title', createdAt: new Date(), updatedAt: new Date() };

        it('should update project master', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(existingProject);
            const updatedProject = { ...existingProject, title: 'Updated Title', updatedAt: new Date() };
            (prisma.projectMaster.update as jest.Mock).mockResolvedValue(updatedProject);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);

            expect(res.status).toBe(200);
            expect(prisma.projectMaster.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pm-1' },
                data: expect.objectContaining({ title: 'Updated Title' })
            }));
        });

        it('should skip update when all fields are unchanged', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ ...existingProject, title: 'Updated Title' });

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);

            expect(res.status).toBe(200);
            expect(prisma.projectMaster.update).not.toHaveBeenCalled();
        });

        it('a) syncOnly=true: should update via $executeRaw without updatedAt/updatedBy in SQL', async () => {
            const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
            (prisma.projectMaster.findUnique as jest.Mock)
                .mockResolvedValueOnce({ ...existingProject, updatedAt: originalUpdatedAt })
                .mockResolvedValueOnce({ ...existingProject, title: 'Updated Title', updatedAt: originalUpdatedAt });
            (prisma as any).$executeRaw = jest.fn().mockResolvedValue(1);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1?syncOnly=true', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);
            expect(res.status).toBe(200);

            // raw SQL が呼ばれ、通常の update は呼ばれない
            expect((prisma as any).$executeRaw).toHaveBeenCalled();
            expect(prisma.projectMaster.update).not.toHaveBeenCalled();

            // SQL に updatedAt / updatedBy が含まれないことを保証（リグレッション防止）
            const sqlArg = (prisma as any).$executeRaw.mock.calls[0][0];
            // Prisma.sql の `strings` から SQL 本体を組み立てて検査
            const sqlText = (sqlArg.strings ?? []).join(' ');
            expect(sqlText).not.toMatch(/updatedAt/i);
            expect(sqlText).not.toMatch(/updatedBy/i);
            expect(sqlText).toContain('"ProjectMaster"');
            expect(sqlText).toContain('"title"');
        });

        it('b) syncOnly absent: should update via prisma.projectMaster.update with updatedBy (unchanged behavior)', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(existingProject);
            (prisma.projectMaster.update as jest.Mock).mockResolvedValue({ ...existingProject, title: 'Updated Title', updatedAt: new Date() });

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);
            expect(res.status).toBe(200);

            expect(prisma.projectMaster.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'pm-1' },
                data: expect.objectContaining({ title: 'Updated Title', updatedBy: 'user-1' }),
            }));
        });

        it('c) syncOnly=true: response.updatedAt should equal pre-request value', async () => {
            const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
            // findUnique は2回呼ばれる: existing 取得用と、トランザクション末尾の取り直し用
            (prisma.projectMaster.findUnique as jest.Mock)
                .mockResolvedValueOnce({ ...existingProject, updatedAt: originalUpdatedAt })
                .mockResolvedValueOnce({ ...existingProject, title: 'Updated Title', updatedAt: originalUpdatedAt });
            (prisma as any).$executeRaw = jest.fn().mockResolvedValue(1);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1?syncOnly=true', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.updatedAt).toBe(originalUpdatedAt.toISOString());
        });

        it('should return 403 if user cannot dispatch', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'PATCH',
                body: JSON.stringify(validBody),
            });

            const res = await PATCH(req, mockContext);

            expect(res.status).toBe(403);
        });
    });

    describe('DELETE', () => {
        it('should delete project master', async () => {
            (prisma.projectMaster.delete as jest.Mock).mockResolvedValue({ id: 'pm-1' });

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'DELETE',
            });

            const res = await DELETE(req, mockContext);

            expect(res.status).toBe(200);
            expect(prisma.projectMaster.delete).toHaveBeenCalledWith({ where: { id: 'pm-1' } });
        });

        it('should return 403 if user is not manager', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api/project-masters/pm-1', {
                method: 'DELETE',
            });

            const res = await DELETE(req, mockContext);

            expect(res.status).toBe(403);
        });
    });
});
