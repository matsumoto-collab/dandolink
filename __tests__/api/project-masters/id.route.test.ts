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

        it('should update project master', async () => {
            const updatedProject = { id: 'pm-1', ...validBody, createdAt: new Date(), updatedAt: new Date() };
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
