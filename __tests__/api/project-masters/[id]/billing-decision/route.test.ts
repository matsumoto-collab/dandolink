/**
 * @jest-environment node
 */
import { PATCH } from '@/app/api/project-masters/[id]/billing-decision/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('PATCH /api/project-masters/[id]/billing-decision（案件×締め月の請求判断）', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };
    const ctx = { params: { id: 'pm-1' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });
        (prisma.projectBillingDecision.upsert as jest.Mock).mockResolvedValue({});
        (prisma.projectBillingDecision.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    function reqWith(body: unknown) {
        return new NextRequest('http://localhost:3000/api/project-masters/pm-1/billing-decision', {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
    }

    it('hold + periodKey を複合キーで upsert する（deleteMany は呼ばない）', async () => {
        const res = await PATCH(reqWith({ decision: 'hold', periodKey: '2026-06' }), ctx);
        expect(res.status).toBe(200);
        expect(prisma.projectBillingDecision.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { projectMasterId_periodKey: { projectMasterId: 'pm-1', periodKey: '2026-06' } },
                update: expect.objectContaining({ decision: 'hold', decidedBy: 'user-1' }),
                create: expect.objectContaining({ projectMasterId: 'pm-1', periodKey: '2026-06', decision: 'hold' }),
            }),
        );
        expect(prisma.projectBillingDecision.deleteMany).not.toHaveBeenCalled();
    });

    it('pending は該当月のレコードを deleteMany する（upsert は呼ばない）', async () => {
        const res = await PATCH(reqWith({ decision: 'pending', periodKey: '2026-06' }), ctx);
        expect(res.status).toBe(200);
        expect(prisma.projectBillingDecision.deleteMany).toHaveBeenCalledWith({
            where: { projectMasterId: 'pm-1', periodKey: '2026-06' },
        });
        expect(prisma.projectBillingDecision.upsert).not.toHaveBeenCalled();
    });

    it('periodKey 未指定は当月(JST)にフォールバックする', async () => {
        const res = await PATCH(reqWith({ decision: 'excluded' }), ctx);
        expect(res.status).toBe(200);
        const call = (prisma.projectBillingDecision.upsert as jest.Mock).mock.calls[0][0];
        expect(call.where.projectMasterId_periodKey.periodKey).toMatch(/^\d{4}-\d{2}$/);
    });

    it('periodKey が不正な形式なら 400（DB に触れない）', async () => {
        const res = await PATCH(reqWith({ decision: 'hold', periodKey: '2026/06' }), ctx);
        expect(res.status).toBe(400);
        expect(prisma.projectBillingDecision.upsert).not.toHaveBeenCalled();
        expect(prisma.projectBillingDecision.deleteMany).not.toHaveBeenCalled();
    });

    it('decision が不正なら 400', async () => {
        const res = await PATCH(reqWith({ decision: 'bogus', periodKey: '2026-06' }), ctx);
        expect(res.status).toBe(400);
    });

    it('案件が存在しなければ 404', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await PATCH(reqWith({ decision: 'hold', periodKey: '2026-06' }), ctx);
        expect(res.status).toBe(404);
        expect(prisma.projectBillingDecision.upsert).not.toHaveBeenCalled();
    });

    it('未認可なら 403', async () => {
        const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
        const res = await PATCH(reqWith({ decision: 'hold', periodKey: '2026-06' }), ctx);
        expect(res.status).toBe(403);
    });
});
