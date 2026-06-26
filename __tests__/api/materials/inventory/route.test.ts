/**
 * @jest-environment node
 *
 * 棚卸し調整 PATCH の C12（レビューA[中] 解消）検証。
 *
 * 攻撃面（成功偽装）:
 *   除外品目（ネット/リース = catalog 権威）はヘルパが skip するのに
 *   route は常に { success:true } を返し「N件更新しました」と偽装していた。
 *
 * 検証観点:
 *   - 除外品目を含む棚卸し送信で appliedCount / excludedCount が
 *     レスポンスに含まれる（UI が「N件は構造除外品目のため変更不可」を可視化可能）
 *   - 構造除外品目の在庫は不変（applyStockChange の早期 return）
 */
import { PATCH } from '@/app/api/materials/inventory/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        materialItem: { findUnique: jest.fn() },
        $transaction: jest.fn(),
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest
        .fn()
        .mockImplementation((msg, error) =>
            NextResponse.json({ error: msg, details: String(error) }, { status: 500 }),
        ),
}));

// 在庫ヘルパは実体を使う（catalog 権威の除外判定を本物で通す）。
// prisma は tx をインメモリ模倣する。
describe('PATCH /api/materials/inventory（C12: skip 件数返却）', () => {
    const session = { user: { id: 'mgr-1', role: 'manager' } };

    // catalog 実データ: 柱=非除外 / シート品目=除外
    const PILLAR = { categoryName: '柱', itemName: '3.6m' };
    const NET = { categoryName: 'シート', itemName: '新築用 青(紐付) 1.8' };

    let stockDb: Record<string, { stockQuantity: number; name: string; categoryName: string }>;

    function makeReq(body: unknown) {
        return new NextRequest('http://localhost/api/materials/inventory', {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session, error: null });
        stockDb = {
            'p-1': { stockQuantity: 10, name: PILLAR.itemName, categoryName: PILLAR.categoryName },
            'net-1': { stockQuantity: 5, name: NET.itemName, categoryName: NET.categoryName },
        };
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) => {
                return cb({
                    materialItem: {
                        findUnique: jest.fn(async ({ where }) => {
                            const row = stockDb[where.id];
                            if (!row) return null;
                            return {
                                stockQuantity: row.stockQuantity,
                                name: row.name,
                                category: { name: row.categoryName },
                            };
                        }),
                        update: jest.fn(async ({ where, data }) => {
                            stockDb[where.id].stockQuantity +=
                                data.stockQuantity.increment;
                            return {};
                        }),
                    },
                    inventoryTransaction: { create: jest.fn(async () => ({})) },
                });
            },
        );
    });

    it('除外品目混在 → appliedCount / excludedCount を返却（成功偽装の解消）', async () => {
        const res = await PATCH(
            makeReq({
                adjustments: [
                    { materialItemId: 'p-1', quantity: 30 }, // 非除外 → 適用
                    { materialItemId: 'net-1', quantity: 99 }, // 構造除外 → skip
                ],
            }),
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.appliedCount).toBe(1);
        expect(json.excludedCount).toBe(1);
        expect(json.skippedCount).toBe(1);
        // 構造除外品目の在庫は不変、非除外のみ反映
        expect(stockDb['p-1'].stockQuantity).toBe(30);
        expect(stockDb['net-1'].stockQuantity).toBe(5);
    });

    it('除外品目なし → excludedCount=0・appliedCount のみ', async () => {
        const res = await PATCH(
            makeReq({ adjustments: [{ materialItemId: 'p-1', quantity: 22 }] }),
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.appliedCount).toBe(1);
        expect(json.excludedCount).toBe(0);
        expect(stockDb['p-1'].stockQuantity).toBe(22);
    });

    it('adjustments 空は 400', async () => {
        const res = await PATCH(makeReq({ adjustments: [] }));
        expect(res.status).toBe(400);
    });
});
