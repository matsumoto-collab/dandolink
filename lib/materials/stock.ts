/**
 * 在庫増減ヘルパ（在庫管理リワーク Phase 3 / 単一の正）
 *
 * --- C1（最重要 / ゲート条件）---
 *   倉庫在庫（MaterialItem.stockQuantity）の自動増減と InventoryTransaction の発行は
 *   「必ず」このモジュールの applyStockChange() を経由する。
 *   API / サービス層は本モジュールの applyStockForRequisition() /
 *   reverseStockForRequisition() / applyInventoryAdjustment() のみを呼び、
 *   直接 prisma で stockQuantity を更新する経路は新設しない。
 *   （C6 是正: loading-list/confirm・inventory 棚卸し調整も本モジュール経由に統合済み）
 *
 *   applyStockChange() の内部で対象品目が lib/materials/catalog.ts の
 *   excludeFromStockDecrement === true（ネット結合品目 / リース品）なら
 *   「早期 return」でスキップする（stockQuantity も InventoryTransaction も触らない）。
 *
 * --- 除外判定の権威（重要 / 是正5）---
 *   除外判定の「単一の正」は lib/materials/catalog.ts（コード）のみ。
 *   本モジュール（および C6 で統合した loading-list/inventory 経路）は
 *   applyStockChange 内で必ず catalog を参照して判定する。
 *   DB 列 MaterialItem.excludeFromStockDecrement は catalog から seed が
 *   片方向同期する「永続ミラー」であり、在庫クエリ側で WHERE 強制に使える
 *   基盤（クエリ最適化・防御層）。Phase 3 の在庫増減判定そのものは
 *   DB 列ではなく catalog（このモジュール経由）を権威とする。
 *
 * --- 除外品目（catalog.ts T1 / T2 決着事項）---
 *   ネット（PDF の 4 結合品目）/ シート / リース品の出庫数量の「正」は
 *   MaterialRequisition.notes の JSON（種類 × サイズ × 車両）であり、
 *   MaterialItem 在庫から自動減算すると二重計上になるため減算をスキップする。
 *
 * --- 冪等性 / ロールバック / 台帳識別子（是正3 で堅牢化）---
 *   「適用済みか」の判定は DB の InventoryTransaction を台帳（ledger）として行う。
 *   forward / reversal の識別は InventoryTransaction.referenceType を
 *   `<source>:forward` / `<source>:reversal` に細分して行う（自由文 notes に依存しない）。
 *   - requisition 由来（[id] PATCH の loaded 遷移）: 'requisition:forward' / 'requisition:reversal'
 *   - loading-list 由来（loading-list/confirm）   : 'loading-list:forward' / 'loading-list:reversal'
 *   deriveLedgerState は同一 referenceId に紐づく :forward / :reversal の
 *   件数比較で適用状態を算出する。referenceId 単位で台帳を共有するため
 *   loading-list 由来 forward も [id] PATCH 側から認識でき二重 apply されない。
 *   notes は人間可読の監査用途のみ（機械判定には使わない）。
 *   schema は referenceType String? のままなのでマイグレーション不要。
 *   クリーンDB前提のため旧 notes マーカー後方互換は持たない。
 *
 * --- 型語彙 ---
 *   既存コードベース（types/material.ts / components/Materials/InventoryPage.tsx）の
 *   InventoryTransaction.type は 'initial' | 'dispatch' | 'return' | 'adjustment'。
 *   Phase 3 の出庫は type='dispatch'（数量は負）、返却伝票は type='return'（数量は正）、
 *   棚卸し調整は type='adjustment'（差分符号）。
 *   逆仕訳は元 forward 行の type を継承し符号のみ反転（是正4）。
 *   ※ Phase 3 要件の「type='out'/'in'」は既存 UI を壊さないため、
 *     方向を quantity の符号で表現する本方式を最妥当解釈として採用（報告に明記）。
 */
import { CATALOG_ITEMS } from './catalog';

/**
 * InventoryTransaction.referenceType の台帳ソース種別。
 * forward/reversal の細分に前置する基底値。
 */
export const LEDGER_SOURCE = {
    /** [id] PATCH の loaded 遷移由来 */
    REQUISITION: 'requisition',
    /** loading-list/confirm 由来（積込リストからの自動出庫） */
    LOADING_LIST: 'loading-list',
} as const;

export type LedgerSource = (typeof LEDGER_SOURCE)[keyof typeof LEDGER_SOURCE];

/** 台帳の方向（順仕訳 / 逆仕訳）。referenceType の接尾辞に使う */
export const LEDGER_DIRECTION = {
    FORWARD: 'forward',
    REVERSAL: 'reversal',
} as const;

export type LedgerDirection =
    (typeof LEDGER_DIRECTION)[keyof typeof LEDGER_DIRECTION];

/**
 * referenceType 文字列を組み立てる（`<source>:<direction>`）。
 * 例: 'requisition:forward' / 'loading-list:reversal'
 */
export function ledgerReferenceType(
    source: LedgerSource,
    direction: LedgerDirection,
): string {
    return `${source}:${direction}`;
}

/**
 * referenceType を { source, direction } に分解（台帳判定で使用）。
 * 形式に合致しない（旧データ / 別用途）の場合は null。
 */
export function parseLedgerReferenceType(
    referenceType: string | null | undefined,
): { source: string; direction: LedgerDirection } | null {
    if (!referenceType) return null;
    const idx = referenceType.lastIndexOf(':');
    if (idx <= 0) return null;
    const source = referenceType.slice(0, idx);
    const direction = referenceType.slice(idx + 1);
    if (
        direction === LEDGER_DIRECTION.FORWARD ||
        direction === LEDGER_DIRECTION.REVERSAL
    ) {
        return { source, direction };
    }
    return null;
}

/**
 * @deprecated 是正3 で referenceType 細分に移行。
 * 旧 'requisition'（細分なし）を読む経路向けの後方互換参照は持たない
 * （クリーンDB前提）。台帳問い合わせは referenceId のみで行う。
 */
export const REQUISITION_REFERENCE_TYPE = LEDGER_SOURCE.REQUISITION;

/** catalog の (categoryName + itemName) -> 除外フラグ の事前構築 Map（DB 非依存） */
const EXCLUDE_MAP: Map<string, boolean> = (() => {
    const m = new Map<string, boolean>();
    for (const it of CATALOG_ITEMS) {
        m.set(`${it.categoryName} ${it.itemName}`, it.excludeFromStockDecrement === true);
    }
    return m;
})();

/**
 * 当該 MaterialItem が倉庫在庫の自動減算対象から除外されるか（純粋関数 / DB 非依存）。
 *
 * 判定の権威は lib/materials/catalog.ts のみ（DB 列ミラーは参照しない）。
 * DB の MaterialItem.category.name が catalog の categoryName、
 * MaterialItem.name が catalog の itemName に対応する
 * （scripts/seed-materials-from-catalog.ts の自然キーと一致）。
 *
 * catalog に存在しない (categoryName,itemName) は除外しない（false）。
 * = 通常どおり在庫減算対象。catalog 由来でない品目を黙ってスキップしない。
 */
export function isMaterialItemExcludedFromStockDecrement(
    categoryName: string,
    itemName: string,
): boolean {
    return EXCLUDE_MAP.get(`${categoryName} ${itemName}`) === true;
}

/**
 * Prisma の既知エラーコード判定（C10）。
 * unique 制約違反は P2002。Prisma を import せず duck-typing で判定する
 * （テストのインメモリモックでも { code: 'P2002' } を投げれば再現できる）。
 */
export function isUniqueConstraintViolation(e: unknown): boolean {
    return (
        typeof e === 'object' &&
        e !== null &&
        (e as { code?: unknown }).code === 'P2002'
    );
}

/** applyStockChange / 台帳問い合わせが必要とする最小 Prisma 形状（テストでモック可能） */
export interface StockPrismaClient {
    materialItem: {
        update(args: {
            where: { id: string };
            data: { stockQuantity: { increment: number } };
        }): Promise<unknown>;
    };
    inventoryTransaction: {
        create(args: {
            data: {
                materialItemId: string;
                quantity: number;
                type: string;
                referenceId: string | null;
                referenceType: string | null;
                notes: string | null;
                createdBy: string | null;
                // C10: 同一適用世代を一意化する決定論的キー（台帳外 Tx は null）
                idempotencyKey: string | null;
            };
        }): Promise<unknown>;
        findMany(args: {
            where: { referenceId: string };
        }): Promise<
            Array<{
                id: string;
                materialItemId: string;
                quantity: number;
                type: string;
                referenceType: string | null;
                notes: string | null;
            }>
        >;
    };
    materialRequisitionItem: {
        findMany(args: {
            where: { requisitionId: string };
            include: { materialItem: { include: { category: true } } };
        }): Promise<
            Array<{
                materialItemId: string;
                quantity: number;
                materialItem: {
                    name: string;
                    category: { name: string };
                };
            }>
        >;
    };
    /**
     * C14: 部分 unique 索引の存在検証に使う raw SQL 実行口。
     * Prisma の $queryRawUnsafe 互換（タグ無し文字列クエリ）。
     * 索引存在チェック専用に最小形状でだけ要求する（テストでモック可能）。
     */
    $queryRawUnsafe?(query: string): Promise<unknown>;
}

/**
 * C14【ブロッカー】部分 unique 索引のランタイム fail-fast。
 *
 * C10 の冪等は DB 側の部分 unique 索引
 * `InventoryTransaction_idempotencyKey_key`（WHERE idempotencyKey IS NOT NULL）
 * によって並行重複 INSERT を構造的に弾くことで成立している。
 * この索引が実 DB に未適用（`prisma migrate deploy` 未実行など）だと、
 * 同一 idempotencyKey の 2 本目以降が P2002 を投げず**全て INSERT 成功**し、
 * 在庫が二重減算される（前ゲート #4 が無音で全面再発）。
 * アプリ層 read-then-write は TOCTOU で原子保証が無いため第二防壁にならない。
 *
 * そこで stock 書込経路の入口で索引の存在を 1 度だけ照会し、
 * 欠如していれば**明示エラーで fail-fast**する（握り潰さない）。
 * 照会結果はプロセス内でキャッシュする（每書込で pg_indexes を引かない）。
 * `$queryRawUnsafe` を持たない最小モック（既存テスト）では検証をスキップする
 * （DB を持たない純粋ロジックテストは対象外。実 prisma は必ず保持する）。
 */
export const IDEMPOTENCY_INDEX_NAME =
    'InventoryTransaction_idempotencyKey_key' as const;

export class MissingIdempotencyIndexError extends Error {
    constructor() {
        super(
            `[在庫整合・致命] 部分 unique 索引 "${IDEMPOTENCY_INDEX_NAME}" が DB に存在しません。` +
                ' これは並行重複の在庫二重減算を防ぐ DB 制約です（C10/#4）。' +
                ' プレデプロイ手順 `prisma migrate deploy` を実行してから再試行してください。',
        );
        this.name = 'MissingIdempotencyIndexError';
    }
}

/**
 * 索引存在検証のプロセス内キャッシュ。
 *   - true  : 検証済みで存在（以降スキップ）
 *   - false/未設定 : 未検証（次回照会する。欠如時は throw するため
 *     「存在しない」を成功キャッシュすることはない）
 */
let idempotencyIndexVerified = false;

/** テスト用: キャッシュ状態をリセット（プロダクション経路では呼ばない） */
export function __resetIdempotencyIndexCacheForTest(): void {
    idempotencyIndexVerified = false;
}

export async function assertIdempotencyIndexPresent(
    tx: StockPrismaClient,
): Promise<void> {
    if (idempotencyIndexVerified) return;
    // 最小モック（DB 非依存の純粋ロジックテスト）には $queryRawUnsafe が無い。
    // その場合は検証不能なのでスキップする（実 prisma は必ず保持する）。
    if (typeof tx.$queryRawUnsafe !== 'function') return;

    // pg_indexes を照会（パラメータは索引名固定。SQL インジェクション面なし）。
    const rows = (await tx.$queryRawUnsafe(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' ` +
            `AND indexname = '${IDEMPOTENCY_INDEX_NAME}' LIMIT 1`,
    )) as unknown;

    const present = Array.isArray(rows) && rows.length > 0;
    if (!present) {
        // 欠如時は throw（握り潰さない / キャッシュもしない＝次回も検証する）
        throw new MissingIdempotencyIndexError();
    }
    idempotencyIndexVerified = true;
}

/** 在庫増減の方向（出庫=dispatch / 返却=return / 棚卸し=adjustment）。 */
export type StockTxType = 'dispatch' | 'return' | 'adjustment';

/** applyStockChange 1 行分の入力 */
export interface ApplyStockChangeArgs {
    /** 対象 MaterialItem の ID（FK） */
    materialItemId: string;
    /** 除外判定に使う catalog 自然キー（DB の category.name / item.name） */
    categoryName: string;
    itemName: string;
    /**
     * 在庫増減量（符号付き）。
     * 出庫（dispatch）は負、返却（return）は正、逆仕訳はその反転値を渡す。
     * 棚卸し（adjustment）は差分（目標値 - 現在値）。
     */
    quantity: number;
    /** 取引種別（既存語彙を維持） */
    type: StockTxType;
    /** InventoryTransaction.referenceId（= requisitionId 等。null 可） */
    referenceId: string | null;
    /**
     * InventoryTransaction.referenceType。
     * 台帳判定対象は ledgerReferenceType() で組んだ `<source>:<direction>` を渡す。
     * 棚卸し調整など台帳判定外は任意の識別子（例 'inventory-adjustment'）。
     */
    referenceType: string;
    /** 監査用 notes（人間可読のみ。機械判定には使わない） */
    note: string;
    /** 実行ユーザー ID */
    createdBy: string | null;
    /**
     * C10: 同一適用世代を一意化する決定論的キー。
     * `<referenceId>:<materialItemId>:<direction>:<generation>` 形式。
     * 並行重複 INSERT は同一キー → DB 部分 unique 違反で 2 本目以降が拒否される。
     * 台帳外 Tx（棚卸し調整など）は null（部分 unique の対象外）。
     */
    idempotencyKey: string | null;
}

export interface ApplyStockChangeResult {
    /** 除外品目（ネット/リース）でスキップしたか */
    skipped: boolean;
    /** スキップ理由（skipped=true のとき） */
    reason?: 'excluded' | 'duplicate';
}

/**
 * 在庫増減 + InventoryTransaction 発行の「唯一の」低レベル関数（C1 の核）。
 *
 * 対象が catalog で excludeFromStockDecrement===true の場合は
 * 早期 return でスキップ（stockQuantity も InventoryTransaction も触らない）。
 * quantity === 0 のときも副作用なし（プレースホルダ行対策）。
 *
 * 本関数はトランザクション内で呼ばれる前提（tx を受け取る）。
 */
export async function applyStockChange(
    tx: StockPrismaClient,
    args: ApplyStockChangeArgs,
): Promise<ApplyStockChangeResult> {
    // --- C1: 除外品目は在庫も Tx も触らず早期 return（catalog が権威）---
    if (isMaterialItemExcludedFromStockDecrement(args.categoryName, args.itemName)) {
        return { skipped: true, reason: 'excluded' };
    }

    // 数量 0 は無副作用（ネット/リースの FK 充足プレースホルダ等の保険）
    if (args.quantity === 0) {
        return { skipped: true };
    }

    // --- C10: 台帳 INSERT を「先」に行い、部分 unique 制約で
    //   並行重複（同一 idempotencyKey）を DB レベルに弾かせる。
    //   stockQuantity の increment は INSERT 成功後のみ行う。
    //   こうすることで P2002（敗者）のとき在庫が二重加減算されない
    //   （旧実装は stock を先に動かしており TOCTOU 二重減算の余地があった）。
    try {
        await tx.inventoryTransaction.create({
            data: {
                materialItemId: args.materialItemId,
                quantity: args.quantity,
                type: args.type,
                referenceId: args.referenceId,
                referenceType: args.referenceType,
                // notes は人間可読の監査用途のみ（機械判定は referenceType で行う）
                notes: args.note,
                createdBy: args.createdBy,
                idempotencyKey: args.idempotencyKey,
            },
        });
    } catch (e) {
        if (isUniqueConstraintViolation(e)) {
            // 並行重複（同一適用世代の二重 INSERT）。
            // 既に勝者が同じ forward/reversal を確定済み → 在庫は触らず
            // 冪等 no-op（呼び出し側が状態再読込で最終状態を確定する）。
            return { skipped: true, reason: 'duplicate' };
        }
        throw e;
    }

    await tx.materialItem.update({
        where: { id: args.materialItemId },
        data: { stockQuantity: { increment: args.quantity } },
    });

    return { skipped: false };
}

/**
 * C10: 当該 referenceId+materialItemId+direction の冪等キーを決定論的に算出する。
 *
 * generation の決め方（並行重複は拒否しつつ reverse→reapply は許す核心）:
 *   - forward を適用するとき: generation = 既存台帳の当該 item の forward 件数。
 *       → 同一状態から並行に走る 2 本の forward は同じ forward 件数を見て
 *         同一 generation → 同一キー → 2 本目が部分 unique 違反で拒否。
 *       → forward→reversal 後の「再 forward」は forward 件数が 1 増えており
 *         generation が進む → 別キー → 正当に許容される。
 *   - reversal を適用するとき: generation = 既存台帳の当該 item の reversal 件数。
 *       → 開いている forward を打ち消す逆仕訳。並行 2 本の reversal は同じ
 *         reversal 件数 → 同一 generation → 同一キー → 2 本目拒否。
 *
 * 台帳行（既存 Tx）の materialItemId / referenceType から件数を数える。
 * 棚卸し調整など台帳外用途は呼び出さない（idempotencyKey=null を渡す）。
 */
export function computeIdempotencyKey(
    referenceId: string,
    materialItemId: string,
    direction: LedgerDirection,
    existingLedgerTxs: Array<{
        materialItemId?: string;
        referenceType: string | null;
    }>,
): string {
    let generation = 0;
    for (const t of existingLedgerTxs) {
        if (t.materialItemId !== materialItemId) continue;
        const parsed = parseLedgerReferenceType(t.referenceType);
        if (!parsed) continue;
        if (parsed.direction === direction) generation += 1;
    }
    return `${referenceId}:${materialItemId}:${direction}:${generation}`;
}

/** requisition の取引台帳サマリ（冪等 / ロールバック判定に使用） */
export interface RequisitionLedgerState {
    /** 順仕訳が記録済みか（未取消で 1 件以上） */
    isApplied: boolean;
    /** 順仕訳が逆仕訳済みか */
    isReversed: boolean;
    /** 順仕訳件数 */
    forwardCount: number;
    /** 逆仕訳件数 */
    reversalCount: number;
}

/** deriveLedgerState が判定に必要とする最小行形状 */
export interface LedgerTxRow {
    referenceType: string | null;
    quantity?: number;
    materialItemId?: string;
    type?: string;
}

/**
 * requisition / loading-list の InventoryTransaction 台帳から
 * 現在の適用状態を算出（純粋判定）。
 *
 * 是正3: 判定は referenceType の `<source>:<direction>` 接尾辞で行う
 * （自由文 notes には依存しない）。source 種別（requisition / loading-list）は
 * 問わず、同一 referenceId に紐づく forward/reversal の件数比較で判定する。
 * これにより loading-list 由来 forward を [id] PATCH 側からも認識でき、
 * 二重 apply / 二重 reverse を防ぐ。
 *
 * isApplied = forward があり、かつ reversal が forward を打ち消していない。
 */
export function deriveLedgerState(
    txs: Array<LedgerTxRow>,
): RequisitionLedgerState {
    let forwardCount = 0;
    let reversalCount = 0;
    for (const t of txs) {
        const parsed = parseLedgerReferenceType(t.referenceType);
        if (!parsed) continue;
        if (parsed.direction === LEDGER_DIRECTION.REVERSAL) reversalCount += 1;
        else if (parsed.direction === LEDGER_DIRECTION.FORWARD) forwardCount += 1;
    }
    return {
        forwardCount,
        reversalCount,
        isApplied: forwardCount > 0 && reversalCount < forwardCount,
        isReversed: forwardCount > 0 && reversalCount >= forwardCount,
    };
}

export interface RequisitionStockOptions {
    /** 返却伝票か（MaterialRequisition.type === '返却'）。true なら符号を反転 */
    isReturn: boolean;
    /** 実行ユーザー ID */
    createdBy: string | null;
    /**
     * 台帳ソース種別（referenceType の接頭辞）。
     * 既定は 'requisition'（[id] PATCH 経路）。
     * loading-list/confirm は 'loading-list' を渡す。
     */
    source?: LedgerSource;
}

export interface RequisitionStockResult {
    /** 何もしなかった（冪等で skip）か */
    noop: boolean;
    /** 在庫を実際に動かした品目数 */
    appliedCount: number;
    /** 除外（ネット/リース）でスキップした品目数 */
    excludedCount: number;
}

/**
 * 同一 referenceId の台帳 Tx を引く（source 種別は問わず referenceId のみ）。
 * 是正3: requisition / loading-list 双方の forward を一つの台帳として扱う。
 */
async function fetchLedgerTxs(
    tx: StockPrismaClient,
    referenceId: string,
) {
    return tx.inventoryTransaction.findMany({ where: { referenceId } });
}

/**
 * 積込完了（loaded 遷移）/ loading-list 自動出庫時に
 * requisition 全行へ在庫増減を適用。
 *
 * 冪等: 既に順仕訳が適用済み（未取消）なら何もしない（noop:true）。
 * 同一 requisitionId に loading-list 由来 forward があっても認識し
 * 二重 apply しない（是正1: loading-list/[id] 台帳統合）。
 * 除外品目（ネット/リース）は applyStockChange 内でスキップされる。
 * 出庫は減算（負）、返却伝票は加算（正）。
 *
 * トランザクション（tx）内で呼ぶこと。
 */
export async function applyStockForRequisition(
    tx: StockPrismaClient,
    requisitionId: string,
    opts: RequisitionStockOptions,
): Promise<RequisitionStockResult> {
    // C14: 部分 unique 索引が無いと並行二重減算が無音で再発するため fail-fast
    await assertIdempotencyIndexPresent(tx);
    const source = opts.source ?? LEDGER_SOURCE.REQUISITION;
    const existing = await fetchLedgerTxs(tx, requisitionId);
    const state = deriveLedgerState(existing);
    if (state.isApplied) {
        // 既に在庫反映済み（requisition / loading-list いずれ由来でも）→ 二重適用しない
        return { noop: true, appliedCount: 0, excludedCount: 0 };
    }

    const items = await tx.materialRequisitionItem.findMany({
        where: { requisitionId },
        include: { materialItem: { include: { category: true } } },
    });

    // --- C13【ブロッカー】dup-materialItemId 過少減算の是正（採用=案A）---
    //   倉庫在庫は全社1プールであり vehicleLabel は伝票/notes/PDF 表示の
    //   関心事にすぎない。一方 components/Materials/MaterialRequisitionPage.tsx
    //   の flattenQuantitiesForApi は「資材を複数車両に分けて積む」標準仕様で
    //   同一 materialItemId を vehicleLabel 0/1/2 ごとに別 MaterialRequisitionItem
    //   行として送出する。従来は item 行ごとに applyStockChange を呼び、
    //   かつ idempotencyKey の generation を「ループ外で 1 回だけ取得した同一
    //   スナップショット existing」から算出していたため、同一 requisition に
    //   同一 materialItemId が複数行あると全行が generation=0 = 同一 idempotencyKey
    //   となり、1 行目だけ INSERT＋減算され 2 行目以降は部分 unique 違反
    //   （P2002 → duplicate skip）で在庫が 2 行目以降の数量分だけ恒久的に
    //   過少減算されていた（reverse も鏡像で過少復元）。
    //   → 在庫台帳は資材合計のみ見ればよいので、伝票内で materialItemId ごとに
    //     quantity を集約してから applyStockChange を materialItemId 単位で
    //     「1 回」呼ぶ。これで (requisition,item,direction,generation) と
    //     idempotencyKey が 1:1 になり、並行冪等（C10）も維持される。
    //   ※ MaterialRequisitionItem の車両別行自体は伝票/PDF 用にそのまま残す
    //     （ここで集約するのは在庫台帳への適用のみ）。
    const aggregated = new Map<
        string,
        { quantity: number; categoryName: string; itemName: string }
    >();
    for (const item of items) {
        const prev = aggregated.get(item.materialItemId);
        if (prev) {
            prev.quantity += item.quantity;
        } else {
            aggregated.set(item.materialItemId, {
                quantity: item.quantity,
                categoryName: item.materialItem.category.name,
                itemName: item.materialItem.name,
            });
        }
    }

    const type: StockTxType = opts.isReturn ? 'return' : 'dispatch';
    const refType = ledgerReferenceType(source, LEDGER_DIRECTION.FORWARD);
    let appliedCount = 0;
    let excludedCount = 0;

    for (const [materialItemId, agg] of aggregated) {
        // 出庫は減算（負）、返却は加算（正）。集約後の合計数量を 1 回で適用。
        const signed = opts.isReturn ? agg.quantity : -agg.quantity;
        // C10: forward の冪等キー。generation = 既存台帳の当該 item の forward 件数。
        //   並行 2 本の forward は同一 generation → 同一キー → DB が 2 本目を拒否。
        //   forward→reversal 後の再 forward は forward 件数が増え別キー → 許容。
        //   C13: materialItemId ごとに 1 回しか呼ばないため
        //   (requisition,item,direction,generation) と key が 1:1 になり
        //   同一 requisition 内 dup-item の自己衝突（過少減算）が解消される。
        const idempotencyKey = computeIdempotencyKey(
            requisitionId,
            materialItemId,
            LEDGER_DIRECTION.FORWARD,
            existing,
        );
        const res = await applyStockChange(tx, {
            materialItemId,
            categoryName: agg.categoryName,
            itemName: agg.itemName,
            quantity: signed,
            type,
            referenceId: requisitionId,
            referenceType: refType,
            note: opts.isReturn ? '返却（積込完了）' : '出庫（積込完了）',
            createdBy: opts.createdBy,
            idempotencyKey,
        });
        if (res.skipped) {
            if (res.reason === 'excluded') excludedCount += 1;
        } else {
            appliedCount += 1;
        }
    }

    // C13: appliedCount / excludedCount は「distinct materialItemId 数」で数える
    //   （行数ではなく集約後の品目数）。戻り値は route/UI 共に件数の意味でのみ
    //   使われ（在庫整合の真実は台帳）行数に依存する箇所は無い。
    return { noop: false, appliedCount, excludedCount };
}

/**
 * loaded から戻す（draft 等）/ loaded のまま items 改変前など、
 * 既適用の requisition 在庫を打ち消す逆仕訳を適用。
 *
 * 冪等: 順仕訳が無い or 既に逆仕訳済みなら何もしない（noop:true）。
 * 逆仕訳は元 forward 行の type を継承し符号のみ反転（是正4）。
 * 除外品目（ネット/リース）はそもそも順仕訳が無いため自然に無視される。
 *
 * C13: forward は applyStockForRequisition で materialItemId ごとに集約済み
 * （= forward 台帳行は distinct item ごと最大 1 本・数量は伝票内合計）。
 * 本関数は forward 台帳行をそのまま符号反転して打ち消すため、
 * 集約合計が漏れなく全量復元される（dup-item でも過少復元しない）。
 *
 * トランザクション（tx）内で呼ぶこと。
 */
export async function reverseStockForRequisition(
    tx: StockPrismaClient,
    requisitionId: string,
    opts: RequisitionStockOptions,
): Promise<RequisitionStockResult> {
    // C14: 部分 unique 索引が無いと並行二重逆仕訳が無音で再発するため fail-fast
    await assertIdempotencyIndexPresent(tx);
    const source = opts.source ?? LEDGER_SOURCE.REQUISITION;
    const existing = await fetchLedgerTxs(tx, requisitionId);
    const state = deriveLedgerState(existing);
    if (!state.isApplied) {
        // 適用されていない or 既に取消済み → 逆仕訳しない
        return { noop: true, appliedCount: 0, excludedCount: 0 };
    }

    // forward 取引（未取消分）を符号反転して打ち消す。
    // referenceType の :forward 接尾辞で判定（source 種別は問わない）。
    const forwards = existing.filter((t) => {
        const parsed = parseLedgerReferenceType(t.referenceType);
        return parsed?.direction === LEDGER_DIRECTION.FORWARD;
    });

    const reversalRefType = ledgerReferenceType(source, LEDGER_DIRECTION.REVERSAL);
    let appliedCount = 0;
    // C10: 同一 referenceId+item に複数 reversal を発行する余地は無いが
    //   （forwards をループするため item ごと最大 1 行）、並行 reverse の
    //   二重逆仕訳を DB で弾くため per-item の reversal 世代を採番する。
    const reversalSeqByItem: Record<string, number> = {};
    for (const t of existing) {
        if (!t.materialItemId) continue;
        const parsed = parseLedgerReferenceType(t.referenceType);
        if (parsed?.direction === LEDGER_DIRECTION.REVERSAL) {
            reversalSeqByItem[t.materialItemId] =
                (reversalSeqByItem[t.materialItemId] ?? 0) + 1;
        }
    }

    for (const fwd of forwards) {
        // forward の符号を反転して在庫を戻す。
        // forward は applyStockChange を通っているため除外品目は存在しない
        // （= 台帳が真実なので台帳に従う）。
        // 是正4: 逆仕訳 type は opts 再決定でなく元 forward 行の type を継承。
        const inheritedType: StockTxType =
            (fwd.type as StockTxType) ?? (opts.isReturn ? 'return' : 'dispatch');
        // C10: reversal の冪等キー。generation = 当該 item の既存 reversal 件数。
        //   並行 2 本の reverse は同一 generation → 同一キー → DB が 2 本目を拒否。
        const generation = reversalSeqByItem[fwd.materialItemId] ?? 0;
        const idempotencyKey = `${requisitionId}:${fwd.materialItemId}:${LEDGER_DIRECTION.REVERSAL}:${generation}`;
        try {
            await tx.inventoryTransaction.create({
                data: {
                    materialItemId: fwd.materialItemId,
                    quantity: -fwd.quantity,
                    type: inheritedType,
                    referenceId: requisitionId,
                    referenceType: reversalRefType,
                    notes: '積込完了の取消（在庫ロールバック）',
                    createdBy: opts.createdBy,
                    idempotencyKey,
                },
            });
        } catch (e) {
            if (isUniqueConstraintViolation(e)) {
                // 並行重複の逆仕訳（敗者）→ 在庫は触らず冪等 no-op としてスキップ
                continue;
            }
            throw e;
        }
        await tx.materialItem.update({
            where: { id: fwd.materialItemId },
            data: { stockQuantity: { increment: -fwd.quantity } },
        });
        appliedCount += 1;
    }

    return { noop: false, appliedCount, excludedCount: 0 };
}

/* ============================================================================
 * 棚卸し調整（C6 是正: inventory route の在庫直接操作を本ヘルパ経由に統合）
 *
 * 在庫数を目標値に合わせる調整。差分（目標 - 現在）を符号付きで
 * applyStockChange へ流し type='adjustment' で記録する。
 * 除外品目（ネット/リース）の調整は applyStockChange が早期 return でスキップ。
 * 台帳判定の対象外（forward/reversal ではない）ため referenceType は
 * 固定識別子 'inventory-adjustment' を使い deriveLedgerState からは無視される。
 * ========================================================================== */

export const INVENTORY_ADJUSTMENT_REFERENCE_TYPE = 'inventory-adjustment' as const;

export interface InventoryAdjustmentInput {
    materialItemId: string;
    categoryName: string;
    itemName: string;
    /** 現在の stockQuantity（差分計算用） */
    currentQuantity: number;
    /** 目標 stockQuantity */
    targetQuantity: number;
    /** 監査用 notes（人間可読） */
    note: string;
}

export interface InventoryAdjustmentResult {
    /** 実際に在庫を動かした品目数 */
    appliedCount: number;
    /** スキップ総数（差分0 + 構造除外 + 重複 すべて含む） */
    skippedCount: number;
    /**
     * C12: 構造除外品目（ネット/リース = catalog 権威）でスキップした件数。
     * UI はこの件数を「N件は構造除外品目のため変更不可」と可視化する。
     * （差分0 によるスキップとは区別する）
     */
    excludedCount: number;
    /** C12: 差分が無く（目標 = 現在）スキップした件数 */
    unchangedCount: number;
}

/**
 * 棚卸し調整（複数品目）。各品目の差分を applyStockChange 経由で適用。
 * 直接 stockQuantity を書き込む経路を残さないための単一ヘルパ（C6）。
 * トランザクション（tx）内で呼ぶこと。
 */
export async function applyInventoryAdjustment(
    tx: StockPrismaClient,
    inputs: InventoryAdjustmentInput[],
    createdBy: string | null,
): Promise<InventoryAdjustmentResult> {
    let appliedCount = 0;
    let excludedCount = 0;
    let unchangedCount = 0;
    for (const inp of inputs) {
        const diff = inp.targetQuantity - inp.currentQuantity;
        if (diff === 0) {
            unchangedCount += 1;
            continue;
        }
        const res = await applyStockChange(tx, {
            materialItemId: inp.materialItemId,
            categoryName: inp.categoryName,
            itemName: inp.itemName,
            quantity: diff,
            type: 'adjustment',
            referenceId: null,
            referenceType: INVENTORY_ADJUSTMENT_REFERENCE_TYPE,
            note: inp.note,
            createdBy,
            // 棚卸し調整は台帳（forward/reversal）外 → 部分 unique の対象外（null）
            idempotencyKey: null,
        });
        if (res.skipped) {
            // C12: 構造除外（catalog 権威）でのスキップを明示集計
            if (res.reason === 'excluded') excludedCount += 1;
            else unchangedCount += 1;
        } else {
            appliedCount += 1;
        }
    }
    return {
        appliedCount,
        excludedCount,
        unchangedCount,
        skippedCount: excludedCount + unchangedCount,
    };
}
