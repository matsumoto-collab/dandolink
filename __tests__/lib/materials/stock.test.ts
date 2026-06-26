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
    assertIdempotencyIndexPresent,
    MissingIdempotencyIndexError,
    IDEMPOTENCY_INDEX_NAME,
    __resetIdempotencyIndexCacheForTest,
    LEDGER_SOURCE,
    LEDGER_DIRECTION,
    type StockPrismaClient,
} from '@/lib/materials/stock';

// --- catalog 実データに基づく自然キー（DB の category.name / item.name に対応）---
const PILLAR = { categoryName: '柱', itemName: '3.6m' }; // 非除外（在庫減算対象）
const HANDRAIL = { categoryName: '手摺', itemName: '1.8m' }; // 非除外
const NET = { categoryName: 'シート', itemName: '新築用 青(紐付) 1.8' }; // 除外（シート）
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
    /** C14: 部分 unique 索引の存在シミュレーション（既定=存在） */
    idempotencyIndexPresent?: boolean;
}) {
    const stock: Record<string, number> = { ...(opts.initialStock ?? {}) };
    for (const it of opts.items) {
        if (!(it.materialItemId in stock)) stock[it.materialItemId] = 100;
    }
    const txs: Array<MockTx & { id: string }> = [];
    let seq = 0;
    const indexPresent = opts.idempotencyIndexPresent ?? true;

    const client: StockPrismaClient = {
        // C14: assertIdempotencyIndexPresent が pg_indexes を照会する口。
        //   索引存在シミュレーションに応じて行を返す/返さない。
        $queryRawUnsafe: jest.fn(async (q: string) => {
            if (q.includes(IDEMPOTENCY_INDEX_NAME)) {
                return indexPresent ? [{ '?column?': 1 }] : [];
            }
            return [];
        }),
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

// C14: assertIdempotencyIndexPresent はプロセス内キャッシュを持つため
//   テスト間で「索引存在検証済み」状態が漏れないよう毎テストでリセットする。
beforeEach(() => {
    __resetIdempotencyIndexCacheForTest();
});

describe('isMaterialItemExcludedFromStockDecrement（純粋関数 / catalog 権威）', () => {
    it('シート品目は除外（true）', () => {
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

/**
 * C13【ブロッカー】dup-materialItemId 過少減算の是正（採用=案A: 伝票内集約）
 *
 * 攻撃面（オーケストレータ再現済み・主経路）:
 *   flattenQuantitiesForApi が「資材を複数車両に分けて積む」標準仕様で
 *   同一 materialItemId を vehicleLabel 0/1/2 ごとに別 MaterialRequisitionItem
 *   行として送出する。round-2 実装は item 行ごとに applyStockChange を呼び、
 *   idempotencyKey の generation を「ループ外 1 回取得の同一スナップショット」
 *   から算出していたため、全行が gen=0 = 同一 idempotencyKey となり
 *   1 行目のみ INSERT＋減算・2 行目以降 P2002 → duplicate skip で
 *   在庫が 2 行目以降の数量分だけ恒久的に過少減算されていた。
 *
 * 受入（差し戻し解除条件）:
 *   同一 materialItemId を vehicleLabel '0' と '1' の 2 行（10 と 7）持つ
 *   loaded 化伝票で在庫が合計 17 減算され、reverse で 17 全量復元、かつ
 *   並行重複適用は依然 1 回に収束。forward→reverse→再forward も dup-item で成立。
 */
describe('C13: 同一 materialItemId 複数行（車両別）の在庫集約', () => {
    it('vehicleLabel 0/1 の 2 行（10,7）→ 合計 17 を 1 回で減算（過少減算しない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            // 同一 materialItemId 'p-1' を 2 行（車両 0:10 / 車両 1:7）
            items: [
                { materialItemId: 'p-1', quantity: 10, ...PILLAR },
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
            ],
            initialStock: { 'p-1': 100 },
        });
        const res = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(res.noop).toBe(false);
        // appliedCount は distinct item 数（行数ではない）→ 1
        expect(res.appliedCount).toBe(1);
        // 合計 17 減算（過少減算 = 100-10=90 ではない）
        expect(stock['p-1']).toBe(83);
        // forward 台帳は distinct item ごと 1 本・数量は伝票内合計
        const forwards = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        );
        expect(forwards).toHaveLength(1);
        expect(forwards[0].quantity).toBe(-17);
        expect(forwards[0].idempotencyKey).toBe('req-1:p-1:forward:0');
    });

    it('reverse で 17 全量復元（鏡像で過少復元しない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 10, ...PILLAR },
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
            ],
            initialStock: { 'p-1': 100 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(83);
        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev.noop).toBe(false);
        expect(stock['p-1']).toBe(100); // 17 全量復元
        const reversals = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(reversals).toHaveLength(1);
        expect(reversals[0].quantity).toBe(17);
    });

    it('forward → reverse → 再 forward が dup-item でも成立（gen 進行・別キー）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 10, ...PILLAR },
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
            ],
            initialStock: { 'p-1': 100 },
        });
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(83);
        await reverseStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(100);
        const re = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(re.noop).toBe(false);
        expect(stock['p-1']).toBe(83); // 再 forward でまた 17 減算
        const fwdKeys = txs
            .filter((t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward')
            .map((t) => t.idempotencyKey);
        expect(fwdKeys).toEqual(['req-1:p-1:forward:0', 'req-1:p-1:forward:1']);
    });

    it('並行重複適用は依然 1 回に収束（dup-item でも二重減算しない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 10, ...PILLAR },
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
            ],
            initialStock: { 'p-1': 100 },
        });
        // 直列 2 回（route C7 ガードを通り抜けても helper 台帳冪等が第二防壁）
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        await applyStockForRequisition(client, 'req-1', { isReturn: false, createdBy: 'u1' });
        expect(stock['p-1']).toBe(83); // 17 を 1 回ぶんのみ
        const forwards = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        );
        expect(forwards).toHaveLength(1);
    });

    it('複数 distinct item × それぞれ複数車両行 → item ごとに集約・appliedCount=distinct数', async () => {
        const { client, stock } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 4, ...PILLAR }, // 車両0
                { materialItemId: 'p-1', quantity: 6, ...PILLAR }, // 車両1（同一 item）
                { materialItemId: 'h-1', quantity: 3, ...HANDRAIL }, // 別 item 車両0
                { materialItemId: 'h-1', quantity: 2, ...HANDRAIL }, // 別 item 車両1
            ],
            initialStock: { 'p-1': 50, 'h-1': 50 },
        });
        const res = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(res.appliedCount).toBe(2); // distinct item 数（p-1, h-1）
        expect(stock['p-1']).toBe(40); // 50 - (4+6)
        expect(stock['h-1']).toBe(45); // 50 - (3+2)
    });

    it('除外品目が複数車両行で来ても集約後に excludedCount=1（distinct数）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'net-1', quantity: 5, ...NET },
                { materialItemId: 'net-1', quantity: 8, ...NET },
                { materialItemId: 'p-1', quantity: 3, ...PILLAR },
            ],
            initialStock: { 'net-1': 50, 'p-1': 50 },
        });
        const res = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(res.appliedCount).toBe(1); // 柱のみ
        expect(res.excludedCount).toBe(1); // ネット（distinct = 1、行数 2 ではない）
        expect(stock['net-1']).toBe(50); // 除外 → 不変
        expect(stock['p-1']).toBe(47);
        expect(txs.filter((t) => t.materialItemId === 'net-1')).toHaveLength(0);
    });
});

/**
 * R5【pre-existing】世代跨ぎ reverse の二重相殺 / キー衝突の是正
 *
 * 攻撃面（実コード検証済）:
 *   旧 reverseStockForRequisition は
 *   (1) 当該 referenceId の **全 :forward 行** を反転対象にし、既に対応
 *       reversal で相殺済みの旧世代 forward（fwd0）も含めていた。
 *   (2) per-item reversal カウント reversalSeqByItem をループ前 1 回算出し
 *       ループ内で発行ごと加算しないため、同一 item の forward が世代跨ぎで
 *       複数あると全反復が同一 generation → 同一 reversal idempotencyKey。
 *   帰結: `apply(fwd0,Q0) → reverse(rev0) → re-apply(fwd1,Q1) → reverse` で
 *   iter1 が既相殺 fwd0 を `…:reversal:1` で逆仕訳し在庫を Q0 戻し、iter2 の
 *   実 open fwd1 が同一キー → unique 違反 skip。fwd1 未反転＋fwd0 二重相殺で
 *   在庫が (Q0−Q1) 分 desync（round-2 C10 forward バグの reverse 側鏡像）。
 *
 * 是正:
 *   (a) net-open のみ反転（既相殺 forward 世代は再反転しない）
 *   (b) reversal idempotencyKey を forward 自身の generation に紐づける
 *   → 並行冪等を維持しつつ世代跨ぎを正しく反転し既相殺を二重反転しない。
 *
 * 受入（実挙動固定）:
 *   最終 reverse 後の在庫＝baseline（Q1 ぶんだけ正しく戻り Q0 二重相殺なし）。
 *   reversal は forward 世代ごとに正しく発行され誤世代の二重逆仕訳が無い。
 */
describe('R5: 世代跨ぎ reverse（net-open のみ反転 / forward 世代紐付け）', () => {
    it('R5 中核: apply(Q0=10) → reverse → re-apply(Q1=3) → reverse で在庫=baseline（Q0 二重相殺なし）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 10, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });

        // 1) apply（Q0=10, gen0 forward）
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(90); // baseline 100 − 10

        // 2) reverse（gen0 forward を打ち消す → baseline 復帰）
        const rev1 = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev1.noop).toBe(false);
        expect(rev1.appliedCount).toBe(1);
        expect(stock['p-1']).toBe(100); // baseline

        // 3) re-apply（数量を Q1=3 に差し替えて再 loaded）。
        //    flatten 行を 10 → 3 に差し替える（loaded items 改変の正規フロー）。
        (client.materialRequisitionItem.findMany as jest.Mock).mockResolvedValue([
            {
                materialItemId: 'p-1',
                quantity: 3,
                materialItem: {
                    name: PILLAR.itemName,
                    category: { name: PILLAR.categoryName },
                },
            },
        ]);
        const reapply = await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(reapply.noop).toBe(false);
        expect(stock['p-1']).toBe(97); // baseline 100 − 3（gen1 forward）

        // 4) reverse（最終）。
        //    旧バグ: fwd0(gen0) を `…:reversal:1` で二重相殺し Q0=10 戻し、
        //            実 open の fwd1(gen1) は同一キー衝突 skip → 在庫 107 で
        //            (Q0−Q1)=7 desync。
        //    是正後: 既相殺 fwd0 は net-open でなく skip、fwd1 のみ正しく
        //            `…:reversal:1` で反転 → baseline 100 へ。
        const rev2 = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev2.noop).toBe(false);
        // net-open は fwd1 のみ → 実際に反転した件数は 1
        expect(rev2.appliedCount).toBe(1);
        // ★ R5 受入: baseline ちょうど（Q0 二重相殺による desync が無い）
        expect(stock['p-1']).toBe(100);

        // 台帳: forward gen0/gen1（各 1）、reversal gen0/gen1（各 1）。
        const fwds = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        );
        const revs = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(fwds.map((t) => t.idempotencyKey).sort()).toEqual([
            'req-1:p-1:forward:0',
            'req-1:p-1:forward:1',
        ]);
        // reversal は forward 世代ごとに 1 本ずつ（誤世代の二重逆仕訳なし）
        expect(revs.map((t) => t.idempotencyKey).sort()).toEqual([
            'req-1:p-1:reversal:0',
            'req-1:p-1:reversal:1',
        ]);
        // reversal の数量は対応 forward の符号反転（gen0=+10, gen1=+3）
        const rev0 = revs.find((t) => t.idempotencyKey === 'req-1:p-1:reversal:0')!;
        const revGen1 = revs.find((t) => t.idempotencyKey === 'req-1:p-1:reversal:1')!;
        expect(rev0.quantity).toBe(10);
        expect(revGen1.quantity).toBe(3);
        // 全 idempotencyKey 一意（同一キー衝突 → skip が起きていない）
        const keys = txs.map((t) => t.idempotencyKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('世代跨ぎ forwards 複数同一 item でも net-open のみ反転（既相殺 fwd は再反転しない）', async () => {
        // 台帳を直接構築: fwd0(-10) / rev0(+10 既相殺) / fwd1(-3 open)
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 3, ...PILLAR }],
            initialStock: { 'p-1': 100 },
        });
        const seed = (
            quantity: number,
            referenceType: string,
            idempotencyKey: string,
        ) =>
            (client.inventoryTransaction.create as jest.Mock)({
                data: {
                    materialItemId: 'p-1',
                    quantity,
                    type: 'dispatch',
                    referenceId: 'req-1',
                    referenceType,
                    notes: 'seed',
                    createdBy: 'u1',
                    idempotencyKey,
                },
            });
        await seed(-10, FWD_REQ, 'req-1:p-1:forward:0');
        await seed(10, REV_REQ, 'req-1:p-1:reversal:0'); // fwd0 を相殺済み
        await seed(-3, FWD_REQ, 'req-1:p-1:forward:1'); // open（未相殺）
        // 在庫は seed では動かしていない（台帳構築のみ）→ 明示的に open 分だけ
        // 減らした状態を起点にする（fwd1 = -3 が現在 open）
        stock['p-1'] = 97;

        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev.noop).toBe(false);
        // net-open は fwd1（gen1）のみ → fwd0(gen0) は既相殺で skip
        expect(rev.appliedCount).toBe(1);
        expect(stock['p-1']).toBe(100); // open 分 3 だけ戻る（10 を二重に戻さない）

        const newReversals = txs.filter(
            (t) =>
                parseLedgerReferenceType(t.referenceType)?.direction === 'reversal' &&
                t.notes !== 'seed',
        );
        expect(newReversals).toHaveLength(1);
        expect(newReversals[0].idempotencyKey).toBe('req-1:p-1:reversal:1');
        expect(newReversals[0].quantity).toBe(3);
    });

    it('並行二重 reverse（同一世代）→ 2 本目 unique 違反 skip・在庫 1 回ぶんのみ（C10 非退行）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 6, ...PILLAR }],
            initialStock: { 'p-1': 50 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(44);

        // 同一台帳スナップショット（fwd0 のみ・reversal 未発行）を 2 リクエストが
        // 観測する状況を直接再現する。findMany を fwd0 時点に固定。
        const fwd0Snapshot = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        );
        (client.inventoryTransaction.findMany as jest.Mock).mockResolvedValue(
            fwd0Snapshot,
        );

        const a = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        const b = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        // 両者 noop=false（state.isApplied は fwd0 で真のまま）だが、
        // 同一 forward 世代 → 同一 reversal キー `…:reversal:0` →
        // 2 本目は DB 部分 unique で拒否され在庫は 1 回ぶんのみ復元。
        expect(a.appliedCount + b.appliedCount).toBe(1);
        expect(stock['p-1']).toBe(50); // 6 を 1 回だけ戻す（二重復元なし）
        const reversals = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(reversals).toHaveLength(1);
        expect(reversals[0].idempotencyKey).toBe('req-1:p-1:reversal:0');
    });

    it('単一世代 DELETE 相当（[fwd0] のみ）reverse が従来どおり全量反転（回帰なし）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [
                { materialItemId: 'p-1', quantity: 7, ...PILLAR },
                { materialItemId: 'h-1', quantity: 4, ...HANDRAIL },
            ],
            initialStock: { 'p-1': 100, 'h-1': 100 },
        });
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(stock['p-1']).toBe(93);
        expect(stock['h-1']).toBe(96);

        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
        });
        expect(rev.noop).toBe(false);
        expect(rev.appliedCount).toBe(2); // 2 distinct item を全量反転
        expect(stock['p-1']).toBe(100);
        expect(stock['h-1']).toBe(100);
        const reversals = txs.filter(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        );
        expect(reversals.map((t) => t.idempotencyKey).sort()).toEqual([
            'req-1:h-1:reversal:0',
            'req-1:p-1:reversal:0',
        ]);
    });

    it('loading-list 由来 forward（source 違い）も :forward で拾い source 非依存に反転（非退行）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 30 },
        });
        // forward を loading-list source で記録
        await applyStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
            source: LEDGER_SOURCE.LOADING_LIST,
        });
        expect(stock['p-1']).toBe(25);
        const fwd = txs.find(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'forward',
        )!;
        expect(fwd.referenceType).toBe(FWD_LL);
        // forward 世代は source 非依存（idempotencyKey は direction ベース）
        expect(fwd.idempotencyKey).toBe('req-1:p-1:forward:0');

        // [id] PATCH 既定 source=requisition で reverse → loading-list:forward を
        // :forward 接尾辞で認識し source 非依存に反転する。
        const rev = await reverseStockForRequisition(client, 'req-1', {
            isReturn: false,
            createdBy: 'u1',
            source: LEDGER_SOURCE.REQUISITION,
        });
        expect(rev.noop).toBe(false);
        expect(rev.appliedCount).toBe(1);
        expect(stock['p-1']).toBe(30); // 全量復元
        const revRow = txs.find(
            (t) => parseLedgerReferenceType(t.referenceType)?.direction === 'reversal',
        )!;
        expect(revRow.idempotencyKey).toBe('req-1:p-1:reversal:0');
    });
});

/**
 * C14【ブロッカー】部分 unique 索引のランタイム fail-fast
 *
 * 攻撃面: 索引 InventoryTransaction_idempotencyKey_key（部分 unique）が
 *   実 DB に未適用だと C10 の DB 強制が無音で無効化し #4（並行二重減算）が
 *   全面再発する。アプリ層 read-then-write は TOCTOU で第二防壁にならない。
 *
 * 受入: 索引不在を模した状態で書込が握り潰さず明示エラーで失敗すること。
 */
describe('C14: 部分 unique 索引の fail-fast ガード', () => {
    it('索引存在時は assertIdempotencyIndexPresent が通過（throw しない）', async () => {
        const { client } = makeMockPrisma({
            items: [],
            idempotencyIndexPresent: true,
        });
        await expect(assertIdempotencyIndexPresent(client)).resolves.toBeUndefined();
    });

    it('索引不在時は applyStockForRequisition が MissingIdempotencyIndexError で fail-fast（在庫を触らない）', async () => {
        const { client, stock, txs } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 100 },
            idempotencyIndexPresent: false,
        });
        await expect(
            applyStockForRequisition(client, 'req-1', {
                isReturn: false,
                createdBy: 'u1',
            }),
        ).rejects.toBeInstanceOf(MissingIdempotencyIndexError);
        // 握り潰さず例外 → 在庫も台帳も一切動かない
        expect(stock['p-1']).toBe(100);
        expect(txs).toHaveLength(0);
    });

    it('索引不在時は reverseStockForRequisition も fail-fast', async () => {
        const { client } = makeMockPrisma({
            items: [{ materialItemId: 'p-1', quantity: 5, ...PILLAR }],
            initialStock: { 'p-1': 100 },
            idempotencyIndexPresent: false,
        });
        await expect(
            reverseStockForRequisition(client, 'req-1', {
                isReturn: false,
                createdBy: 'u1',
            }),
        ).rejects.toBeInstanceOf(MissingIdempotencyIndexError);
    });

    it('検証は成功後プロセス内キャッシュされ pg_indexes 再照会しない', async () => {
        const { client } = makeMockPrisma({
            items: [],
            idempotencyIndexPresent: true,
        });
        await assertIdempotencyIndexPresent(client);
        await assertIdempotencyIndexPresent(client);
        // 1 度だけ照会（2 度目はキャッシュ短絡）
        expect(client.$queryRawUnsafe as jest.Mock).toHaveBeenCalledTimes(1);
    });

    it('$queryRawUnsafe を持たない最小モックでは検証スキップ（純粋ロジックテスト互換）', async () => {
        const minimal = {
            materialItem: { update: jest.fn() },
            inventoryTransaction: {
                create: jest.fn(),
                findMany: jest.fn(async () => []),
            },
            materialRequisitionItem: { findMany: jest.fn(async () => []) },
        } as unknown as StockPrismaClient;
        await expect(assertIdempotencyIndexPresent(minimal)).resolves.toBeUndefined();
    });
});
