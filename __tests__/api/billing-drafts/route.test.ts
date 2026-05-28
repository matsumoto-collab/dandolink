/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/billing-drafts/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/billing-drafts', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('returns billing drafts list with default filters', async () => {
            const mockDrafts = [
                {
                    id: 'bd-1',
                    projectId: 'pm-1',
                    customerId: 'c-1',
                    title: '○○邸 着手金',
                    amount: '100000',
                    taxRate: '0.10',
                    status: 'pending',
                    invoiceId: null,
                    createdById: 'user-1',
                    note: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            ];
            (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue(mockDrafts);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
            expect(prisma.billingDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ deletedAt: null }),
                orderBy: [{ createdAt: 'desc' }],
            }));
        });

        it('filters by status / customerId / projectId / createdById', async () => {
            (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([]);

            const req = new NextRequest(
                'http://localhost:3000/api/billing-drafts?status=confirmed&customerId=c-1&projectId=pm-1&createdById=user-2'
            );
            await GET(req);

            expect(prisma.billingDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    deletedAt: null,
                    status: 'confirmed',
                    customerId: 'c-1',
                    projectId: 'pm-1',
                    createdById: 'user-2',
                }),
            }));
        });

        it('searches across title / note / project / customer / creator with q', async () => {
            (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([]);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts?q=%E4%BD%90%E8%97%A4');
            await GET(req);

            const call = (prisma.billingDraft.findMany as jest.Mock).mock.calls[0][0];
            expect(call.where.OR).toBeDefined();
            expect(call.where.OR).toHaveLength(6);
            expect(call.where.OR[0]).toEqual({ title: { contains: '佐藤', mode: 'insensitive' } });
            expect(call.where.OR[5]).toEqual({ createdBy: { displayName: { contains: '佐藤', mode: 'insensitive' } } });
        });

        it('includes deleted entries when includeDeleted=1', async () => {
            (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([]);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts?includeDeleted=1');
            await GET(req);

            const call = (prisma.billingDraft.findMany as jest.Mock).mock.calls[0][0];
            expect(call.where.deletedAt).toBeUndefined();
        });

        it('returns 403 when not authorized', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts');
            const res = await GET(req);
            expect(res.status).toBe(403);
        });

        it('returns 400 for invalid status enum', async () => {
            const req = new NextRequest('http://localhost:3000/api/billing-drafts?status=bogus');
            const res = await GET(req);
            expect(res.status).toBe(400);
        });
    });

    describe('POST', () => {
        const validBody = {
            projectId: 'pm-1',
            customerId: 'c-1',
            title: '○○邸 着手金',
            amount: '100000',
            taxRate: '0.10',
            note: '初回',
        };

        it('creates a billing draft with status=pending and createdById from session', async () => {
            const created = { id: 'bd-1', ...validBody, status: 'pending', createdById: 'user-1' };
            (prisma.billingDraft.create as jest.Mock).mockResolvedValue(created);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });
            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.billingDraft.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    projectId: 'pm-1',
                    customerId: 'c-1',
                    title: '○○邸 着手金',
                    amount: '100000',
                    taxRate: '0.10',
                    note: '初回',
                    createdById: 'user-1',
                }),
            }));
        });

        it('defaults taxRate to 0.10 when omitted', async () => {
            (prisma.billingDraft.create as jest.Mock).mockResolvedValue({});

            const body = { projectId: 'pm-1', customerId: 'c-1', title: 'タイトル' };
            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            await POST(req);

            expect(prisma.billingDraft.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ taxRate: '0.10' }),
            }));
        });

        it('accepts null amount (空欄)', async () => {
            (prisma.billingDraft.create as jest.Mock).mockResolvedValue({});

            const body = { projectId: 'pm-1', customerId: 'c-1', title: 'タイトル', amount: null };
            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.billingDraft.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ amount: null }),
            }));
        });

        it('returns 400 when title is empty', async () => {
            const body = { projectId: 'pm-1', customerId: 'c-1', title: '' };
            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('returns 400 when projectId is missing', async () => {
            const body = { customerId: 'c-1', title: 'タイトル' };
            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('returns 403 when not authorized', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });
            const res = await POST(req);
            expect(res.status).toBe(403);
        });
    });
});
