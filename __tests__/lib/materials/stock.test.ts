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
