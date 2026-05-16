/**
 * @jest-environment node
 *
 * 積込リスト出庫確定 POST の在庫統合テスト（Phase 3 是正 C6）。
 *
 * 検証観点:
 *   - 在庫減算が lib/materials/stock.ts の applyStockForRequisition 経由で行われ
 *     直接 stockQuantity を書き込む経路を持たないこと
 *   - source='loading-list' で台帳識別子を付与すること（後続 [id] PATCH と
 *     台帳統合され二重 apply されない設計）
 *   - notes が parseRequisitionNotes 互換の JSON（memo に既存文言）で保存され
 *     Phase 2 の notes-JSON 経路と一貫すること
 *   - 在庫副作用が単一トランザクション内で実行されること
 */
import { POST } from '@/app/api/materials/loading-list/confirm/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { applyStockForRequisition, LEDGER_SOURCE } from '@/lib/materials/stock';
import { parseRequisitionNotes } from '@/lib/materials/catalog';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        vehicle: { findUnique: jest.fn() },
        materialRequisition: { create: jest.fn() },
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
    };
});

describe('POST /api/materials/loading-list/confirm（C6 在庫統合）', () => {
    const session = { user: { id: 'mgr-1', name: '管理太郎', role: 'manager' } };

    let createdRequisitions: Array<{ data: Record<string, unknown> }>;
    let txMaterialItemUpdate: jest.Mock;
    let txInventoryTxCreate: jest.Mock;

    function makeReq(body: unknown) {
        return new NextRequest('http://localhost/api/materials/loading-list/confirm', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        createdRequisitions = [];
        txMaterialItemUpdate = jest.fn();
        txInventoryTxCreate = jest.fn();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session, error: null });
        (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ name: '2tトラック' });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) => {
                let seq = 0;
                return cb({
                    __tx: true,
                    materialRequisition: {
                        create: jest.fn(async ({ data }) => {
                            const row = { id: `req-${++seq}`, data };
                            createdRequisitions.push({ data });
                            return row;
                        }),
                    },
                    materialItem: { update: txMaterialItemUpdate },
                    inventoryTransaction: { create: txInventoryTxCreate },
                });
            },
        );
    });

    const validBody = {
        date: '2026-05-16',
        vehicleId: 'veh-1',
        items: [
            { materialItemId: 'm1', projectMasterId: 'pj-1', quantity: 3 },
            { materialItemId: 'm2', projectMasterId: 'pj-1', quantity: 2 },
            { materialItemId: 'm3', projectMasterId: 'pj-2', quantity: 5 },
        ],
    };

    it('在庫減算は applyStockForRequisition 経由（直接 stockQuantity 書き込み無し）', async () => {
        const res = await POST(makeReq(validBody));
        expect(res.status).toBe(200);
        // プロジェクトごとに 1 伝票 → 2 件、それぞれ helper を呼ぶ
        expect(applyStockForRequisition).toHaveBeenCalledTimes(2);
        // route 自身は tx.materialItem.update / inventoryTransaction.create を直接叩かない
        expect(txMaterialItemUpdate).not.toHaveBeenCalled();
        expect(txInventoryTxCreate).not.toHaveBeenCalled();
    });

    it('source=loading-list を helper に渡す（後続 [id] PATCH と台帳統合）', async () => {
        await POST(makeReq(validBody));
        for (const call of (applyStockForRequisition as jest.Mock).mock.calls) {
            expect(call[2]).toEqual(
                expect.objectContaining({
                    isReturn: false,
                    source: LEDGER_SOURCE.LOADING_LIST,
                }),
            );
        }
    });

    it('在庫副作用は単一トランザクション内（tx を helper に渡す）', async () => {
        await POST(makeReq(validBody));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const txArg = (applyStockForRequisition as jest.Mock).mock.calls[0][0];
        expect(txArg).toEqual(expect.objectContaining({ __tx: true }));
    });

    it('notes は parseRequisitionNotes 互換 JSON（memo に「積込リストから自動作成」）', async () => {
        await POST(makeReq(validBody));
        expect(createdRequisitions.length).toBeGreaterThan(0);
        for (const r of createdRequisitions) {
            const notes = r.data.notes as string;
            // プレーン文字列ではなく JSON（v:1）であること
            expect(() => JSON.parse(notes)).not.toThrow();
            const parsed = parseRequisitionNotes(notes);
            expect(parsed.v).toBe(1);
            expect(parsed.memo).toBe('積込リストから自動作成');
            expect(parsed.sheets).toEqual([]);
            expect(parsed.freeForm).toEqual([]);
        }
    });

    it('status=loaded の伝票を loading-list 由来で作成（台帳識別子付き forward は helper が記録）', async () => {
        await POST(makeReq(validBody));
        for (const r of createdRequisitions) {
            expect(r.data.status).toBe('loaded');
            expect(r.data.type).toBe('出庫');
        }
    });

    it('バリデーション失敗（items 空）は 400', async () => {
        const res = await POST(makeReq({ date: '2026-05-16', vehicleId: 'v', items: [] }));
        expect(res.status).toBe(400);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });
});
