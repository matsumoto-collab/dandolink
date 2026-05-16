/**
 * @jest-environment node
 *
 * 出庫伝票 PATCH のステータス遷移 → 在庫ヘルパ呼び出しの結線テスト（Phase 3）。
 *
 * 在庫増減ロジック本体は __tests__/lib/materials/stock.test.ts で網羅済み。
 * 本テストは「どの遷移でどのヘルパが呼ばれるか」（apply / reverse / 呼ばない）
 * と「単一トランザクション内で実行されること」のみを検証する。
 */
import { PATCH } from '@/app/api/materials/requisitions/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { applyStockForRequisition, reverseStockForRequisition } from '@/lib/materials/stock';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        materialRequisition: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        materialRequisitionItem: {
            deleteMany: jest.fn(),
        },
        $transaction: jest.fn(),
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    requireManagerOrAbove: jest.fn(),
    validationErrorResponse: jest
        .fn()
        .mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    serverErrorResponse: jest
        .fn()
        .mockImplementation((msg, error) =>
            NextResponse.json({ error: msg, details: String(error) }, { status: 500 }),
        ),
}));

jest.mock('@/lib/materials/stock', () => ({
    applyStockForRequisition: jest.fn().mockResolvedValue({ noop: false }),
    reverseStockForRequisition: jest.fn().mockResolvedValue({ noop: false }),
}));

describe('PATCH /api/materials/requisitions/[id] 在庫ヘルパ結線', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };
    const mockSession = { user: { id: 'admin-1', role: 'admin' } };

    const txClient = { __tx: true };

    function makeReq(body: unknown) {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        // $transaction(async cb => cb(tx)) を再現
        (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
            return cb({
                ...txClient,
                materialRequisition: { update: jest.fn() },
                materialRequisitionItem: { deleteMany: jest.fn() },
            });
        });
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'draft',
            type: '出庫',
            createdBy: 'admin-1',
            foremanId: 'f-1',
            items: [],
        });
    });

    it('draft → loaded で applyStockForRequisition を呼び reverse は呼ばない', async () => {
        const res = await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(res.status).toBe(200);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
        expect(applyStockForRequisition).toHaveBeenCalledWith(
            expect.objectContaining({ __tx: true }),
            ID,
            expect.objectContaining({ isReturn: false, createdBy: 'admin-1' }),
        );
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
    });

    it('loaded → draft で reverseStockForRequisition を呼び apply は呼ばない（ロールバック）', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
            createdBy: 'admin-1',
            foremanId: 'f-1',
            items: [],
        });
        const res = await PATCH(makeReq({ status: 'draft' }), ctx);
        expect(res.status).toBe(200);
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });

    it('返却伝票は isReturn=true でヘルパに渡す', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'draft',
            type: '返却',
            createdBy: 'admin-1',
            foremanId: 'f-1',
            items: [],
        });
        await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(applyStockForRequisition).toHaveBeenCalledWith(
            expect.anything(),
            ID,
            expect.objectContaining({ isReturn: true }),
        );
    });

    it('ステータス変更なし（notes のみ）では在庫ヘルパを呼ばない', async () => {
        const res = await PATCH(makeReq({ notes: 'メモ更新' }), ctx);
        expect(res.status).toBe(200);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
    });

    it('loaded のまま items 差し替えは reverse → apply の順で呼ぶ（在庫整合）', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
            createdBy: 'admin-1',
            foremanId: 'f-1',
            items: [],
        });
        const callOrder: string[] = [];
        (reverseStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('reverse');
            return { noop: false };
        });
        (applyStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('apply');
            return { noop: false };
        });
        await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm1', quantity: 3 }] }),
            ctx,
        );
        expect(callOrder).toEqual(['reverse', 'apply']);
    });

    it('在庫操作は prisma.$transaction 内で実行される', async () => {
        await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // ヘルパは $transaction のコールバックに渡された tx で呼ばれている
        const txArg = (applyStockForRequisition as jest.Mock).mock.calls[0][0];
        expect(txArg).toEqual(expect.objectContaining({ __tx: true }));
    });

    it('foreman/worker は draft → loaded を 403 で拒否（在庫操作させない）', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'f-1', role: 'foreman' } },
            error: null,
        });
        const res = await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(res.status).toBe(403);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });
});
