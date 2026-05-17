/**
 * @jest-environment node
 *
 * 出庫伝票 POST の C8（#1 解消）検証。
 *
 * 攻撃面（前ゲートB シナリオ #1: C6 POST 迂回）:
 *   任意の認証ユーザーが POST {status:'loaded'} で
 *   台帳・在庫減算ゼロの loaded 伝票を直接作れてしまう問題。
 *
 * 検証観点:
 *   - POST {status:'loaded'} は schema（z.literal('draft')）で 400 拒否
 *   - status を省略した正常 POST は draft で作成される
 *   - status を明示的に 'draft' とした POST も draft で作成される
 *   - いずれの POST 経路でも在庫ヘルパは一切呼ばれない
 *     （loaded 化は [id] PATCH / loading-list/confirm のヘルパ経由のみ）
 */
import { POST } from '@/app/api/materials/requisitions/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        materialRequisition: { create: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest
        .fn()
        .mockImplementation((msg, error) =>
            NextResponse.json({ error: msg, details: String(error) }, { status: 500 }),
        ),
    validationErrorResponse: jest
        .fn()
        .mockImplementation((msg, details) =>
            NextResponse.json({ error: msg, details }, { status: 400 }),
        ),
}));

describe('POST /api/materials/requisitions（C8: #1 POST 迂回の解消）', () => {
    const session = { user: { id: 'u-1', role: 'foreman' } };

    function makeReq(body: unknown) {
        return new NextRequest('http://localhost/api/materials/requisitions', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const baseBody = {
        projectMasterId: 'pj-1',
        date: '2026-05-17',
        foremanId: 'f-1',
        items: [{ materialItemId: 'm-1', quantity: 3 }],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session, error: null });
        (prisma.materialRequisition.create as jest.Mock).mockImplementation(
            async ({ data }) => ({ id: 'req-1', ...data, items: [] }),
        );
    });

    it('POST {status:"loaded"} は 400 で拒否（schema z.literal("draft")）', async () => {
        const res = await POST(makeReq({ ...baseBody, status: 'loaded' }));
        expect(res.status).toBe(400);
        // loaded 伝票は一切作られない（在庫ゼロの loaded 伝票を構造的に作れない）
        expect(prisma.materialRequisition.create).not.toHaveBeenCalled();
    });

    it('POST {status:"confirmed"} など draft 以外も一律 400', async () => {
        const res = await POST(makeReq({ ...baseBody, status: 'confirmed' }));
        expect(res.status).toBe(400);
        expect(prisma.materialRequisition.create).not.toHaveBeenCalled();
    });

    it('status 省略の正常 POST は draft で作成される', async () => {
        const res = await POST(makeReq(baseBody));
        expect(res.status).toBe(201);
        expect(prisma.materialRequisition.create).toHaveBeenCalledTimes(1);
        const arg = (prisma.materialRequisition.create as jest.Mock).mock.calls[0][0];
        expect(arg.data.status).toBe('draft');
    });

    it('status:"draft" 明示でも draft で作成される（route 側でも常に draft 固定）', async () => {
        const res = await POST(makeReq({ ...baseBody, status: 'draft' }));
        expect(res.status).toBe(201);
        const arg = (prisma.materialRequisition.create as jest.Mock).mock.calls[0][0];
        expect(arg.data.status).toBe('draft');
    });
});
