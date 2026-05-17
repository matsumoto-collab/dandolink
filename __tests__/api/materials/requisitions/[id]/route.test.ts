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
import { PATCH, DELETE } from '@/app/api/materials/requisitions/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove } from '@/lib/api/utils';
import { applyStockForRequisition, reverseStockForRequisition } from '@/lib/materials/stock';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        materialRequisition: {
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
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

/**
 * C9（#2 解消 / delta 内 C7 完成）:
 *   loaded→loaded items 差替（現場最頻の編集）の並行 PATCH に
 *   原子ガードが「無かった」問題を固定する。
 *
 * 攻撃面（前ゲートB シナリオ #2）:
 *   旧 isStockTransition は replacingItemsWhileLoaded を含まず
 *   :123 のガードが status 遷移配下のみ → 並行 items 差替が
 *   reverse/apply を二重実行し二重逆仕訳＋二重減算。
 *
 * 検証: loaded のまま items 差替の PATCH は楽観トークン updatedAt を
 *   where に含む条件付き updateMany を「最初」に実行し、
 *   敗者（count===0）は reverse/apply を一切呼ばない（在庫副作用ゼロ）。
 *   勝者（count===1）のみ reverse→apply を各 1 回実行する。
 */
describe('PATCH C9: loaded→loaded items 差替の並行原子ガード', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };
    const mockSession = { user: { id: 'admin-1', role: 'admin' } };
    const FIXED_UPDATED_AT = new Date('2026-05-17T00:00:00.000Z');

    let itemsGuardCount: number;
    let capturedUpdateManyWhere: Record<string, unknown> | null;

    function makeReq(body: unknown) {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        itemsGuardCount = 1;
        capturedUpdateManyWhere = null;
        (requireAuth as jest.Mock).mockResolvedValue({
            session: mockSession,
            error: null,
        });
        (applyStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (reverseStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) => {
                return cb({
                    __tx: true,
                    materialRequisition: {
                        update: jest.fn(),
                        updateMany: jest.fn(async ({ where }) => {
                            capturedUpdateManyWhere = where;
                            return { count: itemsGuardCount };
                        }),
                    },
                    materialRequisitionItem: { deleteMany: jest.fn() },
                });
            },
        );
        // 現状 loaded（items 差替前）
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
            createdBy: 'admin-1',
            foremanId: 'f-1',
            updatedAt: FIXED_UPDATED_AT,
            items: [],
        });
    });

    it('勝者（updateMany.count=1）は updatedAt 楽観トークンで原子ガードしreverse→applyを各1回', async () => {
        itemsGuardCount = 1;
        const callOrder: string[] = [];
        (reverseStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('reverse');
            return { noop: false };
        });
        (applyStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('apply');
            return { noop: false };
        });

        const res = await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm2', quantity: 5 }] }),
            ctx,
        );
        expect(res.status).toBe(200);
        // 楽観トークン（updatedAt）を where に含む条件付き updateMany が実行された
        expect(capturedUpdateManyWhere).toEqual(
            expect.objectContaining({
                id: ID,
                status: 'loaded',
                updatedAt: FIXED_UPDATED_AT,
            }),
        );
        // reverse → apply 各 1 回（在庫整合）
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual(['reverse', 'apply']);
    });

    it('敗者（updateMany.count=0）は reverse/apply を一切呼ばない（二重逆仕訳＋二重減算を構造排除）', async () => {
        itemsGuardCount = 0;
        const res = await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm2', quantity: 5 }] }),
            ctx,
        );
        expect(res.status).toBe(200);
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });

    it('並行 2 本（勝者→敗者）で reverse/apply は合計各 1 回のみ', async () => {
        // 1 本目: 勝者
        itemsGuardCount = 1;
        await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm2', quantity: 5 }] }),
            ctx,
        );
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);

        // 2 本目: 敗者（findUnique は同じ updatedAt を読めても updateMany が 0 件）
        itemsGuardCount = 0;
        await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm3', quantity: 9 }] }),
            ctx,
        );
        // 合計各 1 回のまま（二重実行されない）
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
    });
});

/**
 * C11（#3 解消）:
 *   loaded（在庫適用済み）伝票の DELETE が在庫を巻き戻さず
 *   永久にズレ・台帳孤児化していた問題を固定する。
 *
 * 攻撃面（前ゲートB シナリオ #3）:
 *   DELETE は prisma.delete のみで reverseStockForRequisition 非呼出。
 *
 * 検証: DELETE は同一 $transaction 内で reverseStockForRequisition を
 *   実行してから delete する。reverse → delete の順序を固定。
 */
describe('DELETE C11: loaded 伝票削除時の在庫巻き戻し', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };
    const mockSession = { user: { id: 'mgr-1', role: 'manager' } };

    let callOrder: string[];
    let txDeleteMock: jest.Mock;

    function makeDelReq() {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'DELETE',
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        callOrder = [];
        txDeleteMock = jest.fn(async () => {
            callOrder.push('delete');
            return { id: ID };
        });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({
            session: mockSession,
            error: null,
        });
        (reverseStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('reverse');
            return { noop: false, appliedCount: 1, excludedCount: 0 };
        });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) => {
                return cb({
                    __tx: true,
                    materialRequisition: { delete: txDeleteMock },
                });
            },
        );
    });

    it('loaded 伝票 DELETE は reverseStockForRequisition → delete の順で単一トランザクション', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
        });
        const res = await DELETE(makeDelReq(), ctx);
        expect(res.status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        // tx を helper に渡している（単一トランザクション内で在庫巻き戻し）
        const txArg = (reverseStockForRequisition as jest.Mock).mock.calls[0][0];
        expect(txArg).toEqual(expect.objectContaining({ __tx: true }));
        // reverse が delete より前（在庫巻き戻し後に削除）
        expect(callOrder).toEqual(['reverse', 'delete']);
    });

    it('返却伝票は isReturn=true で reverse を呼ぶ', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '返却',
        });
        await DELETE(makeDelReq(), ctx);
        expect(reverseStockForRequisition).toHaveBeenCalledWith(
            expect.anything(),
            ID,
            expect.objectContaining({ isReturn: true }),
        );
    });

    it('draft 伝票 DELETE でも helper は呼ぶが台帳冪等で noop（在庫副作用なし）', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'draft',
            type: '出庫',
        });
        (reverseStockForRequisition as jest.Mock).mockImplementation(async () => {
            callOrder.push('reverse');
            return { noop: true, appliedCount: 0, excludedCount: 0 };
        });
        const res = await DELETE(makeDelReq(), ctx);
        expect(res.status).toBe(200);
        // helper は呼ぶ（台帳冪等が forward 無し → noop を返す）
        expect(reverseStockForRequisition).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual(['reverse', 'delete']);
    });

    it('存在しない伝票 DELETE は 404（在庫操作しない）', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await DELETE(makeDelReq(), ctx);
        expect(res.status).toBe(404);
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // --- C17: 二重 DELETE の 2 本目を冪等化（P2025 → 成功扱い） ---

    it('C17: 並行 DELETE の 2 本目（delete で P2025）は 500 でなく成功扱い', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
        });
        // reverse は台帳冪等で noop（1 本目で既に取消済み相当）
        (reverseStockForRequisition as jest.Mock).mockResolvedValue({
            noop: true,
            appliedCount: 0,
            excludedCount: 0,
        });
        // $transaction 内の delete が Prisma P2025 を投げる（既に削除済み）
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) =>
                cb({
                    __tx: true,
                    materialRequisition: {
                        delete: jest.fn(async () => {
                            const e = new Error(
                                'Record to delete does not exist',
                            ) as Error & { code: string };
                            e.code = 'P2025';
                            throw e;
                        }),
                    },
                }),
        );
        const res = await DELETE(makeDelReq(), ctx);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ success: true });
    });

    it('C17: P2025 以外のエラーは従来どおり 500（握り潰さない）', async () => {
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
        });
        (reverseStockForRequisition as jest.Mock).mockResolvedValue({ noop: true });
        (prisma.$transaction as jest.Mock).mockImplementation(async () => {
            const e = new Error('DB connection lost') as Error & { code: string };
            e.code = 'P1001';
            throw e;
        });
        const res = await DELETE(makeDelReq(), ctx);
        expect(res.status).toBe(500);
    });
});

/**
 * C15【必達】PATCH status の制約（C8 の対称穴）
 *   materialRequisitionUpdateSchema.status を z.enum(['draft','loaded']) に
 *   絞る。許可外（'archived' 等）は 400。正規 draft↔loaded 遷移は不変。
 *
 * 本 describe は @/lib/validations を実体で通す（route.test 既定でモックなし）。
 */
describe('PATCH C15: status の enum 制約（不正値 400 / 正規遷移は不変）', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };
    const mockSession = { user: { id: 'admin-1', role: 'admin' } };

    function makeReq(body: unknown) {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({
            session: mockSession,
            error: null,
        });
        (applyStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (reverseStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) =>
                cb({
                    __tx: true,
                    materialRequisition: {
                        update: jest.fn(),
                        updateMany: jest.fn(async () => ({ count: 1 })),
                    },
                    materialRequisitionItem: { deleteMany: jest.fn() },
                }),
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

    it("status:'archived' は 400（在庫ヘルパを呼ばない）", async () => {
        const res = await PATCH(makeReq({ status: 'archived' }), ctx);
        expect(res.status).toBe(400);
        expect(applyStockForRequisition).not.toHaveBeenCalled();
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
    });

    it("status:'cancelled' / 任意文字列も 400", async () => {
        expect((await PATCH(makeReq({ status: 'cancelled' }), ctx)).status).toBe(400);
        expect((await PATCH(makeReq({ status: 'foo' }), ctx)).status).toBe(400);
    });

    it("正規 draft→loaded は 200（不変）", async () => {
        const res = await PATCH(makeReq({ status: 'loaded' }), ctx);
        expect(res.status).toBe(200);
        expect(applyStockForRequisition).toHaveBeenCalledTimes(1);
    });

    it("正規 loaded→draft は 200（不変）", async () => {
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
    });

    it('status 未指定（notes のみ）は 200（任意項目）', async () => {
        const res = await PATCH(makeReq({ notes: 'メモ' }), ctx);
        expect(res.status).toBe(200);
    });
});

/**
 * C16【必達】loaded 中 items 差替の特権ゲート（C9 の特権穴）
 *   replacingItemsWhileLoaded（wasLoaded && willBeLoaded && items 配列）も
 *   在庫副作用ありのため requireManagerOrAbove 相当の特権配下に入れる。
 *   非特権が loaded items 差替 PATCH → 403、特権 → 従来どおり。
 */
describe('PATCH C16: loaded 中 items 差替の特権ゲート', () => {
    const ID = 'req-1';
    const ctx = { params: Promise.resolve({ id: ID }) };

    function makeReq(body: unknown) {
        return new NextRequest(`http://localhost/api/materials/requisitions/${ID}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        (applyStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (reverseStockForRequisition as jest.Mock).mockResolvedValue({ noop: false });
        (prisma.$transaction as jest.Mock).mockImplementation(
            async (cb: (tx: unknown) => Promise<unknown>) =>
                cb({
                    __tx: true,
                    materialRequisition: {
                        update: jest.fn(),
                        updateMany: jest.fn(async () => ({ count: 1 })),
                    },
                    materialRequisitionItem: { deleteMany: jest.fn() },
                }),
        );
        // 現状 loaded（その伝票の作成者 = f-1 / 職長 = f-1：所有者条件は満たす）
        (prisma.materialRequisition.findUnique as jest.Mock).mockResolvedValue({
            id: ID,
            status: 'loaded',
            type: '出庫',
            createdBy: 'f-1',
            foremanId: 'f-1',
            updatedAt: new Date('2026-05-17T00:00:00.000Z'),
            items: [],
        });
    });

    it('非特権（foreman / 所有者でも）loaded items 差替 PATCH は 403（在庫操作させない）', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'f-1', role: 'foreman' } },
            error: null,
        });
        const res = await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm1', quantity: 3 }] }),
            ctx,
        );
        expect(res.status).toBe(403);
        // 在庫副作用は一切起きない
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });

    it('非特権（worker）も同様に 403', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'f-1', role: 'worker' } },
            error: null,
        });
        const res = await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm1', quantity: 3 }] }),
            ctx,
        );
        expect(res.status).toBe(403);
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });

    it('特権（manager）は従来どおり loaded items 差替で reverse→apply', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'mgr-1', role: 'manager' } },
            error: null,
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
        const res = await PATCH(
            makeReq({ status: 'loaded', items: [{ materialItemId: 'm1', quantity: 3 }] }),
            ctx,
        );
        expect(res.status).toBe(200);
        expect(callOrder).toEqual(['reverse', 'apply']);
    });

    it('非特権でも loaded のまま notes のみ更新（items 無し）は従来どおり許可', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'f-1', role: 'foreman' } },
            error: null,
        });
        const res = await PATCH(makeReq({ notes: 'メモ更新' }), ctx);
        expect(res.status).toBe(200);
        // items 差替でないので在庫副作用なし
        expect(reverseStockForRequisition).not.toHaveBeenCalled();
        expect(applyStockForRequisition).not.toHaveBeenCalled();
    });
});
