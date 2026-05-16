/**
 * 在庫増減ヘルパ 振る舞い単体テスト（Phase 3 / C1 の防壁）
 *
 * 検証観点:
 *   (a) 除外品目（ネット結合品目 / リース品）を含む伝票を loaded にしても
 *       当該品目の InventoryTransaction は 0 件・stockQuantity 不変
 *   (b) 非除外品目は数量どおり減算 + Tx 生成
 *   (c) loaded → draft 等へ戻すと逆仕訳され在庫が元に戻る
 *   (d) 二重適用されない（冪等）
 *
 * prisma は DB 非依存のインメモリ・モックで再現（DIRECT_URL 不要）。
 * ヘルパは純粋関数的に切り出されており本テストは DB に触れない。
 */
import {
    applyStockForRequisition,
    reverseStockForRequisition,
    applyStockChange,
    isMaterialItemExcludedFromStockDecrement,
    deriveLedgerState,
    STOCK_MARKER,
    REQUISITION_REFERENCE_TYPE,
    type StockPrismaClient,
} from '@/lib/materials/stock';

// --- catalog 実データに基づく自然キー（DB の category.name / item.name に対応）---
const PILLAR = { categoryName: '柱', itemName: '3.6m' }; // 非除外（在庫減算対象）
const HANDRAIL = { categoryName: '手摺', itemName: '1.8m' }; // 非除外
const NET = { categoryName: 'ネット', itemName: '新築用 青(紐付) 1.8' }; // 除外
const LEASE = { categoryName: 'リース品', itemName: 'リース品' }; // 除外

interface MockTx {
    type: string;
    notes: string | null;
    quantity: number;
    materialItemId: string;
}

/**
 * インメモリ Prisma モック。
 * materialItem.stockQuantity と inventoryTransaction を再現し、
 * materialRequisitionItem.findMany は固定の行を返す。
 */
function makeMockPrisma(opts: {
    items: Array<{
        materialItemId: string;
        quantity: number;
        categoryName: string;
        itemName: string;
    }>;
    initialStock?: Record<string, number>;
}) {
    const stock: Record<string, number> = { ...(opts.initialStock ?? {}) };
    for (const it of opts.items) {
        if (!(it.materialItemId in stock)) stock[it.materialItemId] = 100;
    }
    const txs: Array<MockTx & { id: string }> = [];
    let seq = 0;

    const client: StockPrismaClient = {
        materialItem: {
            update: jest.fn(async ({ where, data }) => {
                stock[where.id] = (stock[where.id] ?? 0) + data.stockQuantity.increment;
                return { id: where.id, stockQuantity: stock[where.id] };
            }),
        },
        inventoryTransaction: {
            create: jest.fn(async ({ data }) => {
                const row = { id: `tx-${++seq}`, ...data };
                txs.push(row as MockTx & { id: string });
                return row;
            }),
            findMany: jest.fn(async ({ where }) => {
                return txs.filter(
                    (t) =>
                        where.referenceType === REQUISITION_REFERENCE_TYPE &&
                        // referenceId はモック行に保持されている前提
                        (t as unknown as { referenceId?: string }).referenceId ===
                            where.referenceId,
                );
            }),
        },
        materialRequisitionItem: {
            findMany: jest.fn(async () =>
                opts.items.map((it) => ({
                    materialItemId: it.materialItemId,
                    quantity: it.quantity,
                    materialItem: {
                        name: it.itemName,
                        category: { name: it.categoryName },
                    },
                })),
            ),
        },
    };

    return { client, stock, txs };
}

describe('isMaterialItemExcludedFromStockDecrement（純粋関数 / catalog 権威）', () => {
    it('ネット結合品目は除外（true）', () => {
        expect(
            isMaterialItemExcludedFromStockDecrement(NET.categoryName, NET.itemName),
        ).toBe(true);
    });

    it('リース品は除外（true）', () => {
        expect(
            isMaterialItemExcludedFromStockDecrement(LEASE.categoryName, LEASE.itemName),
        ).toBe(true);
    });

    it('柱 3.6m は非除外（false）', () => {
        expect(
            isMaterialItemExcludedFromStockDecrement(PILLAR.categoryName, PILLAR.itemName),
        ).toBe(false);
    });

    it('catalog に存在しない品目は非除外（false / 黙ってスキップしない）', () => {
        expect(isMaterialItemExcludedFromStockDecrement('未知カテゴリ', '未知品目')).toBe(
            false,
        );
    });
});

describe('applyStockChange（C1 の核 / 除外早期 return）', () => {
    it('除外品目は stockQuantity も InventoryTransaction も触らず skip', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'net-1': 50 },
        });
        const res = await applyStockChange(client, {
            materialItemId: 'net-1',
            categoryName: NET.categoryName,
            itemName: NET.itemName,
            quantity: -10,
            type: 'dispatch',
            referenceId: 'req-1',
            note: 'test',
            marker: STOCK_MARKER.FORWARD,
            createdBy: 'u1',
        });
        expect(res).toEqual({ skipped: true, reason: 'excluded' });
        expect(stock['net-1']).toBe(50);
        expect(txs).toHaveLength(0);
        expect(client.materialItem.update).not.toHaveBeenCalled();
        expect(client.inventoryTransaction.create).not.toHaveBeenCalled();
    });

    it('quantity 0 は無副作用で skip', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 30 },
        });
        const res = await applyStockChange(client, {
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: 0,
            type: 'dispatch',
            referenceId: 'req-1',
            note: 'test',
            marker: STOCK_MARKER.FORWARD,
            createdBy: 'u1',
        });
        expect(res.skipped).toBe(true);
        expect(stock['p-1']).toBe(30);
        expect(txs).toHaveLength(0);
    });

    it('非除外品目は在庫増減 + Tx 生成', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 30 },
        });
        const res = await applyStockChange(client, {
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: -5,
            type: 'dispatch',
            referenceId: 'req-1',
            note: '出庫',
            marker: STOCK_MARKER.FORWARD,
            createdBy: 'u1',
        });
        expect(res).toEqual({ skipped: false });
        expect(stock['p-1']).toBe(25);
        expect(txs).toHaveLength(1);
        expect(txs[0].quantity).toBe(-5);
        expect(txs[0].type).toBe('dispatch');
        expect(txs[0].notes).toContain(STOCK_MARKER.FORWARD);
    });
});

describe('applyStockForRequisition（積込完了 = loaded 遷移）', () => {
    it('(b) 非除外品目は数量どおり減算 + Tx 生成（出庫）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
                { materialItemId: 'h-1', quantity: 3, ...HANDRAIL },
            ],
            initialStock: { 'p-1': 100, 'h-1': 100 },
        });
        const res = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(res.noop).toBe(false);
        expect(res.appliedCount).toBe(2);
        expect(res.excludedCount).toBe(0);
        expect(stock['p-1']).toBe(93);
        expect(stock['h-1']).toBe(97);
        expect(txs).toHaveLength(2);
        expect(txs.every((t) => t.type === 'dispatch')).toBe(true);
        expect(txs.every((t) => t.quantity < 0)).toBe(true);
    });

    it('(a) 除外品目（ネット/リース）を含む伝票を loaded にしても当該品目の Tx は 0 件・在庫不変', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 4, ...PILLAR }, // 非除外
                { materialItemId: 'net-1', quantity: 9, ...NET }, // 除外
                { materialItemId: 'lease-1', quantity: 2, ...LEASE }, // 除外
            ],
            initialStock: { 'p-1': 50, 'net-1': 50, 'lease-1': 50 },
        });
        const res = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(res.appliedCount).toBe(1); // 柱のみ
        expect(res.excludedCount).toBe(2); // ネット + リース
        // 非除外は減算
        expect(stock['p-1']).toBe(46);
        // 除外品目は在庫不変
        expect(stock['net-1']).toBe(50);
        expect(stock['lease-1']).toBe(50);
        // 除外品目の InventoryTransaction は 0 件（柱の 1 件のみ）
        expect(txs).toHaveLength(1);
        expect(txs.filter((t) => t.materialItemId === 'net-1')).toHaveLength(0);
        expect(txs.filter((t) => t.materialItemId === 'lease-1')).toHaveLength(0);
        expect(txs[0].materialItemId).toBe('p-1');
    });

    it('返却伝票は加算（正の数量・type=return）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 6, ...PILLAR }],
            initialStock: { 'p-1': 10 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: true,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(16);
        expect(txs[0].type).toBe('return');
        expect(txs[0].quantity).toBe(6);
    });

    it('(d) 二重適用されない（冪等 / 既適用なら noop）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 40 },
        });
        const r1 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(r1.noop).toBe(false);
        expect(stock['p-1']).toBe(35);
        expect(txs).toHaveLength(1);

        // 2 回目の適用（再 PATCH 相当）は何もしない
        const r2 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(r2.noop).toBe(true);
        expect(r2.appliedCount).toBe(0);
        expect(stock['p-1']).toBe(35); // 不変
        expect(txs).toHaveLength(1); // 増えない
    });
});

describe('reverseStockForRequisition（loaded → draft 等のロールバック）', () => {
    it('(c) loaded → draft に戻すと逆仕訳され在庫が元に戻る', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
                { materialItemId: 'h-1', quantity: 3, ...HANDRAIL },
            ],
            initialStock: { 'p-1': 100, 'h-1': 100 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(93);
        expect(stock['h-1']).toBe(97);

        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev.noop).toBe(false);
        expect(rev.appliedCount).toBe(2);
        // 在庫が元に戻る
        expect(stock['p-1']).toBe(100);
        expect(stock['h-1']).toBe(100);
        // forward 2 + reversal 2
        expect(txs).toHaveLength(4);
        const reversals = txs.filter((t) =>
            (t.notes ?? '').includes(STOCK_MARKER.REVERSAL),
        );
        expect(reversals).toHaveLength(2);
        expect(reversals.every((t) => t.quantity > 0)).toBe(true); // 反転（負→正）
    });

    it('(d) 逆仕訳も冪等（取消済みなら再度の逆仕訳をしない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 40 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(40);
        const txCountAfterFirstReversal = txs.length;

        const again = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(again.noop).toBe(true);
        expect(stock['p-1']).toBe(40); // 不変
        expect(txs).toHaveLength(txCountAfterFirstReversal); // 増えない
    });

    it('未適用の requisition を reverse しても noop（適用前ロールバック防止）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 40 },
        });
        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev.noop).toBe(true);
        expect(stock['p-1']).toBe(40);
        expect(txs).toHaveLength(0);
    });

    it('loaded → draft → loaded の再遷移で在庫が正しく再適用される', async () => {
        const { client, stock } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 8, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });
        // loaded
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(92);
        // draft へ戻す（ロールバック）
        await reverseStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(100);
        // 再び loaded（逆仕訳済みなので再適用される）
        const reapply = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(reapply.noop).toBe(false);
        expect(stock['p-1']).toBe(92);
    });
});

describe('deriveLedgerState（台帳サマリ / 純粋判定）', () => {
    it('forward のみ → isApplied', () => {
        const s = deriveLedgerState([{ notes: `${STOCK_MARKER.FORWARD} x` }]);
        expect(s.isApplied).toBe(true);
        expect(s.isReversed).toBe(false);
    });

    it('forward + 同数 reversal → isReversed', () => {
        const s = deriveLedgerState([
            { notes: `${STOCK_MARKER.FORWARD} x` },
            { notes: `${STOCK_MARKER.REVERSAL} y` },
        ]);
        expect(s.isApplied).toBe(false);
        expect(s.isReversed).toBe(true);
    });

    it('空 → 未適用', () => {
        const s = deriveLedgerState([]);
        expect(s.isApplied).toBe(false);
        expect(s.isReversed).toBe(false);
    });
});
