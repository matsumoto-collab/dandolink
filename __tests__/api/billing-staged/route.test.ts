/**
 * @jest-environment node
 */
import { GET, POST, DELETE } from '@/app/api/billing-staged/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, requireManagerOrAccountant } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/billing-staged（請求待ちボードの請求対象の永続化）', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

    const validItems = [
        { id: 'it-1', description: '足場工事', quantity: 1, unit: '式', unitPrice: 100000, amount: 100000, projectMasterId: 'pm-1' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (requireManagerOrAccountant as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (prisma.billingStagedLine.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.billingStagedLine.upsert as jest.Mock).mockResolvedValue({});
        (prisma.billingStagedLine.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    function postReq(body: unknown) {
        return new NextRequest('http://localhost:3000/api/billing-staged', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    }

    function deleteReq(body: unknown) {
        return new NextRequest('http://localhost:3000/api/billing-staged', {
            method: 'DELETE',
            body: JSON.stringify(body),
        });
    }

    describe('GET', () => {
        it('請求対象を案件IDつきで返す（Cache-Control: no-store）', async () => {
            (prisma.billingStagedLine.findMany as jest.Mock).mockResolvedValue([
                { projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: 100000, label: '見積どおり' },
            ]);
            const res = await GET();
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            const body = await res.json();
            expect(body).toEqual([
                { projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: 100000, label: '見積どおり' },
            ]);
        });

        it('items が配列でない壊れた行は空配列に落として返す', async () => {
            (prisma.billingStagedLine.findMany as jest.Mock).mockResolvedValue([
                { projectMasterId: 'pm-1', customerId: 'cus-1', items: null, total: 0, label: '' },
            ]);
            const res = await GET();
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body[0].items).toEqual([]);
        });

        it('未認可なら 403（税理士も含めた閲覧認可でガードする）', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAccountant as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
            const res = await GET();
            expect(res.status).toBe(403);
            expect(prisma.billingStagedLine.findMany).not.toHaveBeenCalled();
        });
    });

    describe('POST', () => {
        it('案件IDをキーに upsert し、stagedBy にセッションユーザーを入れる', async () => {
            const res = await POST(
                postReq({ projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: 100000, label: '見積どおり' }),
            );
            expect(res.status).toBe(200);
            expect(prisma.billingStagedLine.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { projectMasterId: 'pm-1' },
                    update: expect.objectContaining({ customerId: 'cus-1', total: 100000, label: '見積どおり', stagedBy: 'user-1' }),
                    create: expect.objectContaining({ projectMasterId: 'pm-1', customerId: 'cus-1', stagedBy: 'user-1' }),
                }),
            );
        });

        it('projectMasterId が無ければ 400（DB に触れない）', async () => {
            const res = await POST(postReq({ customerId: 'cus-1', items: validItems, total: 1, label: '' }));
            expect(res.status).toBe(400);
            expect(prisma.billingStagedLine.upsert).not.toHaveBeenCalled();
        });

        it('customerId が無ければ 400', async () => {
            const res = await POST(postReq({ projectMasterId: 'pm-1', items: validItems, total: 1, label: '' }));
            expect(res.status).toBe(400);
        });

        it('items が空配列なら 400', async () => {
            const res = await POST(postReq({ projectMasterId: 'pm-1', customerId: 'cus-1', items: [], total: 1, label: '' }));
            expect(res.status).toBe(400);
        });

        it('total が数値でなければ 400', async () => {
            const res = await POST(
                postReq({ projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: '100000', label: '' }),
            );
            expect(res.status).toBe(400);
        });

        it('label が文字列でなければ 400', async () => {
            const res = await POST(
                postReq({ projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: 100, label: 123 }),
            );
            expect(res.status).toBe(400);
        });

        it('未認可なら 403（税理士は追加できない＝書き込みは manager 以上）', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
            const res = await POST(
                postReq({ projectMasterId: 'pm-1', customerId: 'cus-1', items: validItems, total: 100, label: '' }),
            );
            expect(res.status).toBe(403);
            expect(prisma.billingStagedLine.upsert).not.toHaveBeenCalled();
        });
    });

    describe('DELETE', () => {
        it('指定した案件の請求対象をまとめて削除する', async () => {
            (prisma.billingStagedLine.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
            const res = await DELETE(deleteReq({ projectMasterIds: ['pm-1', 'pm-2'] }));
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ deleted: 2 });
            expect(prisma.billingStagedLine.deleteMany).toHaveBeenCalledWith({
                where: { projectMasterId: { in: ['pm-1', 'pm-2'] } },
            });
        });

        it('projectMasterIds が空配列なら 400（全件削除させない）', async () => {
            const res = await DELETE(deleteReq({ projectMasterIds: [] }));
            expect(res.status).toBe(400);
            expect(prisma.billingStagedLine.deleteMany).not.toHaveBeenCalled();
        });

        it('projectMasterIds に文字列以外が混ざれば 400', async () => {
            const res = await DELETE(deleteReq({ projectMasterIds: ['pm-1', 123] }));
            expect(res.status).toBe(400);
            expect(prisma.billingStagedLine.deleteMany).not.toHaveBeenCalled();
        });

        it('未認可なら 403', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
            const res = await DELETE(deleteReq({ projectMasterIds: ['pm-1'] }));
            expect(res.status).toBe(403);
            expect(prisma.billingStagedLine.deleteMany).not.toHaveBeenCalled();
        });
    });
});
