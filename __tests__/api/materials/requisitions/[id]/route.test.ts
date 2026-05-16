/**
 * @jest-environment node
 *
 * 出庫伝票 PATCH のステータス遷移 → 在庫ヘルパ呼び出しの結線テスト
 * （Phase 3 + 是正 C7 並行制御）。
 *
 * 在庫増減ロジック本体は __tests__/lib/materials/stock.test.ts で網羅済み。
 * 本テストは「どの遷移でどのヘルパが呼ばれるか」（apply / reverse / 呼ばない）、
 * 「単一トランザクション内で実行されること」、および
 * 「C7: 並行 PATCH 時に条件付き updateMany で TOCTOU を防ぐ」を検証する。
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
            updateMany: jest.fn(),
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

jest.mock('@/lib/materials/stock', () => {
    const actual = jest.requireActual('@/lib/materials/stock');
    return {
        ...actual,
        applyStockForRequisition: jest.fn().mockResolvedValue({ noop: false }),
        reverseStockForRequisition: jest.fn().mockResolvedValue({ noop: false }),
    };
});

describe('PATCH /api/materials/requisitions/[id] 在庫ヘルパ結線 + C7 並行制御', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };
    const mockSession = { user: { id: 'admin-1', role: 'admin' } };

    const txClient = { __tx: true };
    // updateMany の戻り（C7 ガード）。既定は勝者（count:1）
    let guardCount = 1;

    function makeReq(body: unknown) {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        guardCount = 1;
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) => {
                return cb({
                    ...txClient,
                    materialRequisition: {
                        update: jest.fn(),
                        updateMany: jest.fn(async () => ({ count: guardCount })),
                    },
                    materialRequisitionItem: { deleteMany: jest.fn() },
                });
            },
        );
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

    // --- C7: 並行 PATCH TOCTOU ガード ---

    it('C7: 並行で先に loaded 化された場合 updateMany.count=0 → 在庫副作用しない（二重 forward 防止）', async () => {
        // 別リクエストが先に draft→loaded 済み: 条件付き updateMany が 0 件
        guardCount = 0;
        const res = await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(res.status).toBe(200);
        // 在庫ヘルパは一切呼ばれない（forward の二重計上が塞がれる）
        expect(applyStockForRequisition).not.toHaveBeenCalled();
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
    });

    it('C7: 勝者（updateMany.count=1）は通常どおり applyStockForRequisition を実行', async () => {
        guardCount = 1;
        const res = await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(res.status).toBe(200);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
    });

    it('C7: 並行 2 リクエスト（勝者→敗者）で apply は 1 回のみ', async () => {
        // 1 件目: 勝者
        guardCount = 1;
        await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);

        // 2 件目: 敗者（findUnique は draft のまま読めても updateMany が 0 件）
        guardCount = 0;
        await PATCH(makeReq({ status: 'loaded' }), ctx);
        // 2 件目では呼ばれず、合計 1 回のまま
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
    });
});
