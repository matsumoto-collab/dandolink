/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/project-masters/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/project-masters', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Since we have global mocks, we can override them here if needed
        // But the global mocks should be sufficient for happy paths
        // We do need to ensure requireAuth returns what we expect for each test
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('should return project masters list', async () => {
            const mockProjects = [
                { id: '1', title: 'Project 1', createdAt: new Date() },
                { id: '2', title: 'Project 2', createdAt: new Date() },
            ];
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue(mockProjects);
            (prisma.projectMaster.count as jest.Mock).mockResolvedValue(2);

            const req = new NextRequest('http://localhost:3000/api/project-masters?page=1&limit=10');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.data).toHaveLength(2);
            expect(prisma.projectMaster.findMany).toHaveBeenCalledTimes(1);
        });

        it('should handle search params', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.projectMaster.count as jest.Mock).mockResolvedValue(0);

            const req = new NextRequest('http://localhost:3000/api/project-masters?search=Test&status=active');
            await GET(req);

            expect(prisma.projectMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    status: 'active',
                    OR: expect.arrayContaining([
                        { title: { contains: 'Test', mode: 'insensitive' } }
                    ])
                })
            }));
        });
    });

    describe('POST', () => {
        const validBody = {
            title: 'New Project',
            customerId: 'cust-1',
            status: 'active',
        };

        it('should create a project master', async () => {
            const createdProject = { id: 'new-1', ...validBody, createdAt: new Date(), updatedAt: new Date() };
            (prisma.projectMaster.create as jest.Mock).mockResolvedValue(createdProject);

            const req = new NextRequest('http://localhost:3000/api/project-masters', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.projectMaster.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    title: 'New Project',
                    customerId: 'cust-1',
                })
            }));
        });

        it('should return 400 validation error for missing title', async () => {
            const invalidBody = { ...validBody, title: undefined };

            const req = new NextRequest('http://localhost:3000/api/project-masters', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('should return 403 if user cannot dispatch', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api/project-masters', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(403);
        });

        it('should return 401 if not authenticated', async () => {
            const errorRes = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/project-masters', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(401);
        });
    });
});
