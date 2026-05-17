/**
 * 在庫増減ヘルパ 振る舞い単体テスト（Phase 3 / C1 の防壁 + Phase 3 是正 C6/C7）
 *
 * 検証観点:
 *   (a) 除外品目（ネット結合品目 / リース品）を含む伝票を loaded にしても
 *       当該品目の InventoryTransaction は 0 件・stockQuantity 不変
 *   (b) 非除外品目は数量どおり減算 + Tx 生成
 *   (c) loaded → draft 等へ戻すと逆仕訳され在庫が元に戻る
 *   (d) 二重適用されない（冪等）
 *   (e) 是正3: 台帳識別子は referenceType の <source>:<direction> で堅牢判定
 *   (f) 是正1: loading-list 由来 forward を requisition 台帳からも認識（二重 apply 防止）
 *   (g) 是正4: 逆仕訳 type は元 forward 行の type を継承
 *   (h) 是正C7: 並行/再入で二重 forward が起きない（冪等 + 台帳統合）
 *   (i) 是正1: 棚卸し調整 applyInventoryAdjustment が helper 経由・除外品目スキップ
 *
 * prisma は DB 非依存のインメモリ・モックで再現（DIRECT_URL 不要）。
 * ヘルパは純粋関数的に切り出されており本テストは DB に触れない。
 */
import {
    applyStockForRequisition,
    reverseStockForRequisition,
    applyStockChange,
    applyInventoryAdjustment,
    isMaterialItemExcludedFromStockDecrement,
    isUniqueConstraintViolation,
    computeIdempotencyKey,
    deriveLedgerState,
    ledgerReferenceType,
    parseLedgerReferenceType,
    LEDGER_SOURCE,
    LEDGER_DIRECTION,
    type StockPrismaClient,
} from '@/lib/materials/stock';

// --- catalog 実データに基づく自然キー（DB の category.name / item.name に対応）---
const PILLAR = { categoryName: '柱', itemName: '3.6m' }; // 非除外（在庫減算対象）
const HANDRAIL = { categoryName: '手摺', itemName: '1.8m' }; // 非除外
const NET = { categoryName: 'ネット', itemName: '新築用 青(紐付) 1.8' }; // 除外
const LEASE = { categoryName: 'リース品', itemName: 'リース品' }; // 除外

const FWD_REQ = ledgerReferenceType(LEDGER_SOURCE.REQUISITION, LEDGER_DIRECTION.FORWARD);
const REV_REQ = ledgerReferenceType(LEDGER_SOURCE.REQUISITION, LEDGER_DIRECTION.REVERSAL);
const FWD_LL = ledgerReferenceType(LEDGER_SOURCE.LOADING_LIST, LEDGER_DIRECTION.FORWARD);

interface MockTx {
    type: string;
    notes: string | null;
    quantity: number;
    materialItemId: string;
    referenceId: string | null;
    referenceType: string | null;
    idempotencyKey: string | null;
}

/** Prisma P2002（unique 制約違反）相当のエラー（テスト用） */
class MockUniqueError extends Error {
    code = 'P2002';
    constructor() {
        super('Unique constraint failed (mock idempotencyKey)');
    }
}

/**
 * インメモリ Prisma モック。
 * materialItem.stockQuantity と inventoryTransaction を再現し、
 * materialRequisitionItem.findMany は固定の行を返す。
 * 是正3: 台帳問い合わせは referenceId のみ（source 種別は問わない）。
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
                // C10: 部分 unique（idempotencyKey IS NOT NULL）を DB のように再現。
                //   同一 idempotencyKey の 2 本目は P2002 を投げる。
                if (
                    data.idempotencyKey != null &&
                    txs.some((t) => t.idempotencyKey === data.idempotencyKey)
                ) {
                    throw new MockUniqueError();
                }
                const row = { id: `tx-${++seq}`, ...data };
                txs.push(row as MockTx & { id: string });
                return row;
            }),
            findMany: jest.fn(async ({ where }) => {
                return txs.filter((t) => t.referenceId === where.referenceId);
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

describe('台帳識別子（是正3: referenceType <source>:<direction>）', () => {
    it('ledgerReferenceType / parseLedgerReferenceType がラウンドトリップ', () => {
        const rt = ledgerReferenceType(LEDGER_SOURCE.REQUISITION, LEDGER_DIRECTION.FORWARD);
        expect(rt).toBe('requisition:forward');
        expect(parseLedgerReferenceType(rt)).toEqual({
            source: 'requisition',
            direction: 'forward',
        });
    });

    it('loading-list 用も同様の :forward / :reversal で組める', () => {
        expect(ledgerReferenceType(LEDGER_SOURCE.LOADING_LIST, LEDGER_DIRECTION.REVERSAL))
            .toBe('loading-list:reversal');
    });

    it('非台帳の referenceType（旧/別用途）は null（誤判定しない）', () => {
        expect(parseLedgerReferenceType('requisition')).toBeNull(); // 旧細分なし
        expect(parseLedgerReferenceType('loading-list')).toBeNull();
        expect(parseLedgerReferenceType('inventory-adjustment')).toBeNull();
        expect(parseLedgerReferenceType(null)).toBeNull();
        expect(parseLedgerReferenceType('')).toBeNull();
        expect(parseLedgerReferenceType(':forward')).toBeNull();
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
            referenceType: FWD_REQ,
            note: 'test',
            createdBy: 'u1',
            idempotencyKey: 'req-1:net-1:forward:0',
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
            referenceType: FWD_REQ,
            note: 'test',
            createdBy: 'u1',
            idempotencyKey: 'req-1:p-1:forward:0',
        });
        expect(res.skipped).toBe(true);
        expect(stock['p-1']).toBe(30);
        expect(txs).toHaveLength(0);
    });

    it('非除外品目は在庫増減 + Tx 生成（notes は人間可読のみ・判定は referenceType）', async () => {
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
            referenceType: FWD_REQ,
            note: '出庫',
            createdBy: 'u1',
            idempotencyKey: 'req-1:p-1:forward:0',
        });
        expect(res).toEqual({ skipped: false });
        expect(stock['p-1']).toBe(25);
        expect(txs).toHaveLength(1);
        expect(txs[0].quantity).toBe(-5);
        expect(txs[0].type).toBe('dispatch');
        expect(txs[0].referenceType).toBe(FWD_REQ);
        // notes は機械マーカーを含まない（人間可読のみ）
        expect(txs[0].notes).toBe('出庫');
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
        expect(txs.every((t) => t.referenceType === FWD_REQ)).toBe(true);
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
        expect(stock['p-1']).toBe(46);
        expect(stock['net-1']).toBe(50);
        expect(stock['lease-1']).toBe(50);
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

        const r2 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(r2.noop).toBe(true);
        expect(r2.appliedCount).toBe(0);
        expect(stock['p-1']).toBe(35);
        expect(txs).toHaveLength(1);
    });

    it('(h) 同一 requisition に loading-list 由来 forward があると requisition 経路は noop（是正1 二重 apply 防止）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 40 },
        });
        // loading-list/confirm 相当: source='loading-list' で forward 記録
        const r1 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
            source: LEDGER_SOURCE.LOADING_LIST,
        });
        expect(r1.noop).toBe(false);
        expect(stock['p-1']).toBe(35);
        expect(txs[0].referenceType).toBe(FWD_LL);

        // 後続の [id] PATCH（source=requisition 既定）→ 同一 referenceId の
        // loading-list:forward を台帳上 forward として認識し二重 apply しない
        const r2 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
            source: LEDGER_SOURCE.REQUISITION,
        });
        expect(r2.noop).toBe(true);
        expect(stock['p-1']).toBe(35); // 二重減算されない
        expect(txs).toHaveLength(1);
    });

    it('(h) 並行/再入で 2 回連続 apply しても forward は 1 回のみ（冪等の連打耐性）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 8, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });
        // 直列に 2 回（route 側 C7 ガードを通り抜けても helper 台帳冪等が第二防壁）
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(92); // 1 回ぶんのみ減算
        expect(txs.filter((t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward'))
            .toHaveLength(1);
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
        expect(stock['p-1']).toBe(100);
        expect(stock['h-1']).toBe(100);
        expect(txs).toHaveLength(4);
        const reversals = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(reversals).toHaveLength(2);
        expect(reversals.every((t) => t.quantity > 0)).toBe(true);
        expect(reversals.every((t) => t.referenceType === REV_REQ)).toBe(true);
    });

    it('(g) 逆仕訳 type は元 forward 行の type を継承（opts 再決定でない）', async () => {
        const { client, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 6, ...PILLAR }],
            initialStock: { 'p-1': 50 },
        });
        // forward を type=return（返却伝票）で記録
        await applyStockForRequisition(client, 'req-1', {
            isReturn: true,
            createdBy: 'u1',
        });
        const fwd = txs.find(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        )!;
        expect(fwd.type).toBe('return');

        // reverse 時に opts.isReturn=false を誤って渡しても、
        // 逆仕訳 type は元 forward の 'return' を継承する（dispatch にならない）
        await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        const rev = txs.find(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        )!;
        expect(rev.type).toBe('return'); // 継承（opts.isReturn=false に引きずられない）
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
        expect(stock['p-1']).toBe(40);
        expect(txs).toHaveLength(txCountAfterFirstReversal);
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
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(92);
        await reverseStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(100);
        const reapply = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(reapply.noop).toBe(false);
        expect(stock['p-1']).toBe(92);
    });
});

describe('deriveLedgerState（台帳サマリ / 是正3: referenceType 判定）', () => {
    it('forward のみ → isApplied', () => {
        const s = deriveLedgerState([{ referenceType: FWD_REQ }]);
        expect(s.isApplied).toBe(true);
        expect(s.isReversed).toBe(false);
    });

    it('forward + 同数 reversal → isReversed', () => {
        const s = deriveLedgerState([
            { referenceType: FWD_REQ },
            { referenceType: REV_REQ },
        ]);
        expect(s.isApplied).toBe(false);
        expect(s.isReversed).toBe(true);
    });

    it('source 種別が混在しても direction だけで集計（loading-list forward も forward）', () => {
        const s = deriveLedgerState([
            { referenceType: FWD_LL },
            { referenceType: REV_REQ },
        ]);
        expect(s.forwardCount).toBe(1);
        expect(s.reversalCount).toBe(1);
        expect(s.isReversed).toBe(true);
    });

    it('非台帳 referenceType（棚卸し調整等）は無視', () => {
        const s = deriveLedgerState([
            { referenceType: 'inventory-adjustment' },
            { referenceType: null },
        ]);
        expect(s.forwardCount).toBe(0);
        expect(s.reversalCount).toBe(0);
        expect(s.isApplied).toBe(false);
    });

    it('空 → 未適用', () => {
        const s = deriveLedgerState([]);
        expect(s.isApplied).toBe(false);
        expect(s.isReversed).toBe(false);
    });
});

describe('applyInventoryAdjustment（C6: 棚卸し調整も helper 経由）', () => {
    it('差分（目標 - 現在）を increment で適用し type=adjustment で記録', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 30 },
        });
        const res = await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'p-1',
                    categoryName: PILLAR.categoryName,
                    itemName: PILLAR.itemName,
                    currentQuantity: 30,
                    targetQuantity: 42,
                    note: '棚卸し調整',
                },
            ],
            'u1',
        );
        expect(res.appliedCount).toBe(1);
        expect(stock['p-1']).toBe(42); // 30 + (42-30)
        expect(txs[0].type).toBe('adjustment');
        expect(txs[0].quantity).toBe(12);
        expect(txs[0].referenceId).toBeNull();
        expect(txs[0].referenceType).toBe('inventory-adjustment');
    });

    it('差分 0 は skip（在庫・Tx 不変）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 10 },
        });
        const res = await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'p-1',
                    categoryName: PILLAR.categoryName,
                    itemName: PILLAR.itemName,
                    currentQuantity: 10,
                    targetQuantity: 10,
                    note: 'x',
                },
            ],
            'u1',
        );
        expect(res.skippedCount).toBe(1);
        expect(res.appliedCount).toBe(0);
        expect(stock['p-1']).toBe(10);
        expect(txs).toHaveLength(0);
    });

    it('除外品目（ネット/リース）の棚卸し調整は applyStockChange 内でスキップ', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'net-1': 5 },
        });
        const res = await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'net-1',
                    categoryName: NET.categoryName,
                    itemName: NET.itemName,
                    currentQuantity: 5,
                    targetQuantity: 99,
                    note: '棚卸し',
                },
            ],
            'u1',
        );
        expect(res.appliedCount).toBe(0);
        expect(res.skippedCount).toBe(1);
        expect(stock['net-1']).toBe(5); // 除外品目は在庫不変
        expect(txs).toHaveLength(0);
    });

    it('台帳判定（deriveLedgerState）に influence しない（forward/reversal でない）', async () => {
        const { client, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 1 },
        });
        await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'p-1',
                    categoryName: PILLAR.categoryName,
                    itemName: PILLAR.itemName,
                    currentQuantity: 1,
                    targetQuantity: 9,
                    note: 'x',
                },
            ],
            'u1',
        );
        const s = deriveLedgerState(txs);
        expect(s.isApplied).toBe(false);
        expect(s.forwardCount).toBe(0);
    });
});

/**
 * C10（#4 解消 / 冪等を DB 部分 unique 制約で強制）
 *
 * 攻撃面（前ゲートB シナリオ #4）:
 *   冪等が deriveLedgerState のアプリ層 read-then-write のみ
 *   = 並行下で原子保証なし（TOCTOU で二重 forward）。
 *
 * 設計要件（テストで固定）:
 *   - 同一適用世代の並行重複 forward は同一 idempotencyKey → DB 部分 unique
 *     違反で 2 本目が拒否され 1 本のみ成立（在庫も 1 回ぶんのみ）。
 *   - forward → reverse → forward（loaded items 差替の正規フロー）は
 *     generation が進み別キーになるため正当に再適用できる。
 *   - P2002 はヘルパ内で握りつぶし「冪等 no-op」扱い（例外を伝播しない）。
 */
describe('C10: InventoryTransaction 冪等キー（並行重複拒否 / reverse→reapply 許容）', () => {
    it('isUniqueConstraintViolation は P2002 のみ true', () => {
        expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(true);
        expect(isUniqueConstraintViolation({ code: 'P2003' })).toBe(false);
        expect(isUniqueConstraintViolation(new Error('x'))).toBe(false);
        expect(isUniqueConstraintViolation(null)).toBe(false);
    });

    it('computeIdempotencyKey: forward generation は既存 forward 件数で進む', () => {
        // 台帳なし → gen0
        expect(
            computeIdempotencyKey('req-1', 'p-1', LEDGER_DIRECTION.FORWARD, []),
        ).toBe('req-1:p-1:forward:0');
        // forward 1 + reversal 1（1 サイクル完了）→ 次 forward は gen1
        const ledger = [
            { materialItemId: 'p-1', referenceType: FWD_REQ },
            { materialItemId: 'p-1', referenceType: REV_REQ },
        ];
        expect(
            computeIdempotencyKey('req-1', 'p-1', LEDGER_DIRECTION.FORWARD, ledger),
        ).toBe('req-1:p-1:forward:1');
        // 別 item は独立採番（gen0）
        expect(
            computeIdempotencyKey('req-1', 'h-1', LEDGER_DIRECTION.FORWARD, ledger),
        ).toBe('req-1:h-1:forward:0');
    });

    it('同一 idempotencyKey の 2 本目 INSERT は P2002 → applyStockChange が duplicate skip（在庫 1 回ぶんのみ）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 100 },
        });
        const key = 'req-1:p-1:forward:0';
        const args = {
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: -5,
            type: 'dispatch' as const,
            referenceId: 'req-1',
            referenceType: FWD_REQ,
            note: '出庫',
            createdBy: 'u1',
            idempotencyKey: key,
        };
        // 1 本目: 成立
        const r1 = await applyStockChange(client, args);
        expect(r1).toEqual({ skipped: false });
        expect(stock['p-1']).toBe(95);
        expect(txs).toHaveLength(1);

        // 2 本目: 同一キー → DB 部分 unique 違反（P2002）→ 握りつぶして duplicate skip
        const r2 = await applyStockChange(client, args);
        expect(r2).toEqual({ skipped: true, reason: 'duplicate' });
        // 在庫は二重減算されない（敗者は increment しない）
        expect(stock['p-1']).toBe(95);
        expect(txs).toHaveLength(1);
    });

    it('並行重複 forward（同一台帳スナップショットから 2 本）→ DB が 2 本目を拒否し forward は 1 本のみ', async () => {
        // 2 本のリクエストが「まだ forward が無い」同じ台帳を観測し
        // 同一 idempotencyKey を算出する状況を直接再現する。
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 7, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });
        const staleLedger: Array<{
            materialItemId?: string;
            referenceType: string | null;
        }> = []; // 両リクエストが観測する空スナップショット
        const key = computeIdempotencyKey(
            'req-1',
            'p-1',
            LEDGER_DIRECTION.FORWARD,
            staleLedger,
        );
        const mkArgs = () => ({
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: -7,
            type: 'dispatch' as const,
            referenceId: 'req-1',
            referenceType: FWD_REQ,
            note: '出庫',
            createdBy: 'u1',
            idempotencyKey: key,
        });
        const a = await applyStockChange(client, mkArgs());
        const b = await applyStockChange(client, mkArgs());
        // どちらか 1 本だけ成立、もう 1 本は duplicate skip
        const successes = [a, b].filter((r) => r.skipped === false);
        const dupes = [a, b].filter((r) => r.reason === 'duplicate');
        expect(successes).toHaveLength(1);
        expect(dupes).toHaveLength(1);
        expect(stock['p-1']).toBe(93); // 7 を 1 回ぶんのみ減算
        const forwards = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        );
        expect(forwards).toHaveLength(1);
    });

    it('forward → reverse → forward は generation が進み別キーで正当に成立（DB 拒否しない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 8, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });
        // 1) forward（gen0）
        const f1 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(f1.noop).toBe(false);
        expect(stock['p-1']).toBe(92);

        // 2) reverse（gen0 reversal）
        const rv = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rv.noop).toBe(false);
        expect(stock['p-1']).toBe(100);

        // 3) 再 forward（gen1 → 別キー）。DB unique に弾かれず成立する。
        const f2 = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(f2.noop).toBe(false);
        expect(stock['p-1']).toBe(92);

        // 台帳: forward 2（gen0/gen1）+ reversal 1。キーは全て異なる。
        const keys = txs.map((t) => t.idempotencyKey);
        expect(new Set(keys).size).toBe(keys.length); // 全キー一意
        const fwdKeys = txs
            .filter(
                (t) =>
                    parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
            )
            .map((t) => t.idempotencyKey);
        expect(fwdKeys).toEqual([
            'req-1:p-1:forward:0',
            'req-1:p-1:forward:1',
        ]);
    });

    it('reverse の並行重複も DB 部分 unique で 2 本目拒否（二重逆仕訳防止）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 6, ...PILLAR }],
            initialStock: { 'p-1': 50 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(44);

        // 同一 reversal キーを 2 本（並行 reverse の敗者を再現）。
        // 1 本目: 成立。
        const revKey = 'req-1:p-1:reversal:0';
        const ok = await applyStockChange(client, {
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: 6,
            type: 'dispatch',
            referenceId: 'req-1',
            referenceType: REV_REQ,
            note: '取消',
            createdBy: 'u1',
            idempotencyKey: revKey,
        });
        expect(ok.skipped).toBe(false);
        expect(stock['p-1']).toBe(50);
        // 2 本目（同一 reversal キー）→ P2002 → duplicate skip（二重逆仕訳しない）
        const dup = await applyStockChange(client, {
            materialItemId: 'p-1',
            categoryName: PILLAR.categoryName,
            itemName: PILLAR.itemName,
            quantity: 6,
            type: 'dispatch',
            referenceId: 'req-1',
            referenceType: REV_REQ,
            note: '取消',
            createdBy: 'u1',
            idempotencyKey: revKey,
        });
        expect(dup).toEqual({ skipped: true, reason: 'duplicate' });
        expect(stock['p-1']).toBe(50); // 二重に戻さない
        const reversals = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(reversals).toHaveLength(1);
    });
});

/**
 * C12（レビューA[中] 解消）: applyInventoryAdjustment の skip 内訳。
 * 構造除外（ネット/リース = catalog 権威）と差分0スキップを区別して返す。
 */
describe('C12: applyInventoryAdjustment skip 内訳（除外件数の可視化）', () => {
    it('除外品目混在 → excludedCount に計上・在庫不変、非除外は適用', async () => {
        const { client, stock } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 10, 'net-1': 5, 'lease-1': 3 },
        });
        const res = await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'p-1',
                    categoryName: PILLAR.categoryName,
                    itemName: PILLAR.itemName,
                    currentQuantity: 10,
                    targetQuantity: 25,
                    note: '棚卸し',
                },
                {
                    materialItemId: 'net-1',
                    categoryName: NET.categoryName,
                    itemName: NET.itemName,
                    currentQuantity: 5,
                    targetQuantity: 99,
                    note: '棚卸し',
                },
                {
                    materialItemId: 'lease-1',
                    categoryName: LEASE.categoryName,
                    itemName: LEASE.itemName,
                    currentQuantity: 3,
                    targetQuantity: 88,
                    note: '棚卸し',
                },
            ],
            'u1',
        );
        expect(res.appliedCount).toBe(1); // 柱のみ
        expect(res.excludedCount).toBe(2); // ネット + リース
        expect(res.unchangedCount).toBe(0);
        expect(res.skippedCount).toBe(2);
        expect(stock['p-1']).toBe(25);
        expect(stock['net-1']).toBe(5); // 構造除外 → 不変
        expect(stock['lease-1']).toBe(3);
    });

    it('差分0 は unchangedCount に計上（excludedCount とは区別）', async () => {
        const { client } = makeMockPrisma({
            items: [],
            initialStock: { 'p-1': 7 },
        });
        const res = await applyInventoryAdjustment(
            client,
            [
                {
                    materialItemId: 'p-1',
                    categoryName: PILLAR.categoryName,
                    itemName: PILLAR.itemName,
                    currentQuantity: 7,
                    targetQuantity: 7,
                    note: 'x',
                },
            ],
            'u1',
        );
        expect(res.appliedCount).toBe(0);
        expect(res.excludedCount).toBe(0);
        expect(res.unchangedCount).toBe(1);
        expect(res.skippedCount).toBe(1);
    });
});
