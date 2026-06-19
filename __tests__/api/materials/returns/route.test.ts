/**
 * @jest-environment node
 *
 * 返却 POST /api/materials/returns の検証。
 *
 * 検証観点:
 *   - 職長（非特権）でも返却を確定できる（requireAuth のみ）
 *   - サーバ側で貸出中（出庫 − 返却 − 紛失, loaded のみ）を上限に数量クランプ
 *   - type='返却' / status='loaded' の伝票を作成し applyStockForRequisition(isReturn) を呼ぶ
 *   - 貸出中が無い品目はドロップ、全部 0 なら 400
 *
 * lentOut 集計は本物（@/lib/materials/lentOut）を使い、prisma / stock のみモックする。
 */
import { POST } from '@/app/api/materials/returns/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { applyStockForRequisition } from '@/lib/materials/stock';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: { $transaction: jest.fn() },
}));

jest.mock('@/lib/materials/stock', () => ({
    ...jest.requireActual('@/lib/materials/stock'),
    applyStockForRequisition: jest.fn().mockResolvedValue({ noop: false, appliedCount: 1, excludedCount: 0 }),
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: msg, details }, { status: 400 })),
}));

function mkLentItem(materialItemId: string, quantity: number) {
    return {
        materialItemId,
        quantity,
        materialItem: {
            name: materialItemId, spec: null, unit: '本', sortOrder: 0,
            category: { name: '柱', sortOrder: 0 },
        },
    };
}

describe('POST /api/materials/returns', () => {
    const session = { user: { id: 'u-1', username: 'foreman-a', role: 'foreman1' } };

    function makeReq(body: unknown) {
        return new NextRequest('http://localhost/api/materials/returns', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // tx.materialRequisition.findMany が返す「loaded 伝票」を差し替えるためのホルダ
    let loadedReqs: Array<{ type: string; status: string; items: ReturnType<typeof mkLentItem>[] }>;
    let createdData: Record<string, unknown> | null;

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session, error: null });
        loadedReqs = [];
        createdData = null;

        (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
            const tx = {
                materialRequisition: {
                    findMany: jest.fn().mockResolvedValue(loadedReqs),
                    create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
                        createdData = data;
                        return { id: 'ret-1', ...data, items: [] };
                    }),
                },
            };
            return cb(tx);
        });
    });

    it('職長でも返却でき、貸出中を上限に数量クランプして在庫を戻す', async () => {
        // 貸出中: m-1 = 100（出庫100）, m-2 = 0
        loadedReqs = [{ type: '出庫', status: 'loaded', items: [mkLentItem('m-1', 100)] }];

        const res = await POST(makeReq({
            projectMasterId: 'pj-1',
            items: [
                { materialItemId: 'm-1', quantity: 150 }, // 100 にクランプ
                { materialItemId: 'm-2', quantity: 10 },  // 貸出中0 → ドロップ
            ],
        }));

        expect(res.status).toBe(201);
        // 作成伝票は type='返却' / status='loaded'、items は m-1=100 のみ
        expect(createdData).toMatchObject({ type: '返却', status: 'loaded', projectMasterId: 'pj-1' });
        const items = (createdData!.items as { create: Array<{ materialItemId: string; quantity: number }> }).create;
        expect(items).toEqual([{ materialItemId: 'm-1', quantity: 100 }]);
        // 在庫加算ヘルパが isReturn=true で呼ばれる
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
        expect((applyStockForRequisition as jest.Mock).mock.calls[0][2]).toMatchObject({ isReturn: true });
    });

    it('貸出中がすべて 0 なら 400（在庫加算しない）', async () => {
        loadedReqs = []; // 何も出ていない
        const res = await POST(makeReq({
            projectMasterId: 'pj-1',
            items: [{ materialItemId: 'm-1', quantity: 5 }],
        }));
        expect(res.status).toBe(400);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });

    it('返却で貸出中が減っている分はクランプ上限も減る', async () => {
        // 出庫100 − 返却40 = 貸出中60
        loadedReqs = [
            { type: '出庫', status: 'loaded', items: [mkLentItem('m-1', 100)] },
            { type: '返却', status: 'loaded', items: [mkLentItem('m-1', 40)] },
        ];
        const res = await POST(makeReq({
            projectMasterId: 'pj-1',
            items: [{ materialItemId: 'm-1', quantity: 100 }],
        }));
        expect(res.status).toBe(201);
        const items = (createdData!.items as { create: Array<{ materialItemId: string; quantity: number }> }).create;
        expect(items).toEqual([{ materialItemId: 'm-1', quantity: 60 }]);
    });
});
