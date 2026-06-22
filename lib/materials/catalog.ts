/**
 * 材料カタログ（コード上の単一の正 / single source of truth）
 *
 * このファイルは在庫管理リワークの土台です。
 * Phase 2 以降は以下の両方をここから生成します:
 *   1. 出庫伝票 PDF (components/pdf/MaterialRequisitionSlipPDF.tsx) の 3 列レイアウト
 *   2. 出庫伝票 入力フォーム (components/Materials/MaterialRequisitionPage.tsx)
 * Phase 2 で PDF / フォーム / 印刷経路 / ライブプレビューを本ファイル由来の
 * 生成に切替済み（COL1/COL2/COL3 の二重定義は解消）。
 * 生成用のレイアウトは buildPdfLayout() / PDF_LAYOUT を参照。
 *
 * --- 導出元と突き合わせ ---
 *   - scripts/seed-materials.ts                        : 現行 DB のカテゴリ / 品目 / 単位
 *   - components/pdf/MaterialRequisitionSlipPDF.tsx    : PDF の列 (COL1/COL2/COL3) / グループ / 行順 / spec
 *
 * --- 自然キー ---
 *   (categoryName, itemName) を品目の自然キーとする。
 *   PDF の getQty(categoryName, itemName, vehicleIndex) という実行時ルックアップ契約に一致させるため、
 *   catalog の categoryName / itemName は PDF レイアウト側の表記を「正」として採用する。
 *   seed-materials.ts と表記が異なる品目は本ファイル末尾の KNOWN_DISCREPANCIES に明記。
 *
 * --- PDF グループ同一性 ---
 *   PDF は同一列内に複数の「ラベル無し（''）グループ」を別ブロックとして持つ。
 *   そのためグループの同一性は groupLabel ではなく (column, groupIndex) で識別する
 *   （PdfPlacement.groupIndex は列内のグループ通し番号 / 自動採番）。
 *
 * --- 初期在庫 ---
 *   全品目 initialStock = 0（Phase 1 の確定要件）。
 *
 * --- シート（ネット）/ リース品について（決着済み）---
 *   ネット / シート / リース品も物理在庫だが、出庫数量の「正」は
 *   MaterialRequisition.notes の JSON（種類 × サイズ × 車両）とする。
 *   二重計上を防ぐため、これらの CatalogItem は excludeFromStockDecrement = true とし、
 *   倉庫在庫（MaterialItem.stockQuantity）の自動増減対象から除外する。
 *   catalog 上には在庫対象 (CatalogItem) として残す。理由:
 *   MaterialRequisitionItem.materialItemId（非 null FK）が MaterialItem の実在を
 *   要求するため、対応する MaterialItem を seed しておく必要がある
 *   （MaterialRequisition.notes は String? でありそこに FK は存在しない）。
 *
 *   除外判定の「単一の正」はこの catalog.ts（コード）のみ。
 *   Phase 3 の在庫増減ヘルパ（lib/materials/stock.ts）および C6 で統合した
 *   loading-list/confirm・inventory 棚卸し調整経路は、いずれも統合 helper
 *   （applyStockChange）を経由し、その内部で catalog を権威として参照する。
 *   DB 列 MaterialItem.excludeFromStockDecrement は catalog から seed が
 *   片方向同期する「永続ミラー」であり、在庫クエリ側の WHERE 強制に使える
 *   防御基盤（死蔵フラグではない）。在庫判定そのものの権威は catalog。
 *   （末尾 OPEN_DESIGN_TENSIONS T1 / T2 を参照）
 */

/** PDF の物理列 */
export type PdfColumn = 'COL1' | 'COL2' | 'COL3';

/** PDF 配置情報 */
export interface PdfPlacement {
    /** 物理列 */
    column: PdfColumn;
    /**
     * 列内のグループ通し番号（0 起点）。
     * PDF は同一列内に複数の「ラベル無し（'' ）グループ」を別ブロックとして持つため、
     * グループの同一性は groupLabel ではなく (column, groupIndex) で識別する。
     */
    groupIndex: number;
    /** 列内のグループラベル（空文字 '' はラベル無しグループ。PDF と一致させる） */
    groupLabel: string;
    /** グループ内の表示順（0 起点） */
    orderInGroup: number;
}

/** カタログ品目 */
export interface CatalogItem {
    /** 表示カテゴリ名（自然キーの一部 / PDF の categoryName と一致） */
    categoryName: string;
    /** 品目名（自然キーの一部 / PDF の itemName と一致） */
    itemName: string;
    /** PDF / フォームで表示する spec ラベル */
    specLabel: string;
    /** 単位（seed 由来、無指定は '本'） */
    unit: string;
    /** カテゴリ単位の表示順（カテゴリ間の並び） */
    categorySortOrder: number;
    /** カテゴリ内の品目表示順（0 起点） */
    itemSortOrder: number;
    /** PDF 配置 */
    pdf: PdfPlacement;
    /** 初期在庫（Phase 1 は全品目 0 固定） */
    initialStock: number;
    /**
     * 倉庫在庫の自動増減（Phase 3 の MaterialItem.stockQuantity 減算）対象から除外するフラグ。
     *
     * 根拠（ユーザー確定事項 / OPEN_DESIGN_TENSIONS T1・T2 参照）:
     *   - ネット（PDF の 4 結合品目: 例「新築用 青(紐付) 1.8」）/ シート / リース品 の
     *     出庫数量は MaterialRequisition.notes の JSON（種類 × サイズ × 車両）が「正」となる。
     *   - これらを MaterialItem 在庫からも自動減算すると notes-JSON と二重計上になる。
     *
     * 権威と DB 列の関係（是正5 / 実態に整合）:
     *   - 除外判定の「単一の正」はこの catalog（コード）。Phase 3 の在庫増減
     *     ヘルパ（lib/materials/stock.ts の applyStockChange）はこの catalog を
     *     参照して true の品目の減算をスキップする。C6 で統合した
     *     loading-list/confirm・inventory 棚卸し経路も同じ helper を経由するため
     *     判定権威は一元化されている（DB 列は参照しない）。
     *   - DB スキーマ列 MaterialItem.excludeFromStockDecrement（Boolean
     *     @default(false)）は本フラグを seed が片方向同期する「永続ミラー」で、
     *     在庫クエリ側で WHERE 強制に使える防御基盤（死蔵ではない）。
     *   - seed スクリプトは upsert 時に本フラグを MaterialItem へ同期する（冪等）。
     *   - 未設定（undefined）は false 相当（= 通常どおり在庫減算対象）。
     */
    excludeFromStockDecrement?: boolean;
}

/** カタログカテゴリ（seed の MaterialCategory に対応） */
export interface CatalogCategory {
    name: string;
    sortOrder: number;
}

/**
 * シート（ネット）の種類固定定数。7 種。
 * 現行 seed-materials.ts の「新素用」は誤字。ここでは「新築用」に修正して定義する。
 * （PDF 側の spec ラベルも「新築用 青(紐付) 1.8」表記であり、こちらが正）
 */
export const SHEET_TYPES = [
    '新築用 青(紐付)',
    'グレー5.4',
    'グレー6.3',
    '青',
    '黒',
    '緑',
    '白',
] as const;

export type SheetType = (typeof SHEET_TYPES)[number];

/**
 * カタログ本体。
 *
 * 設計方針:
 *   - PDF レイアウト (COL1/COL2/COL3) を「背骨」とし、行順 / グループ / spec は PDF に一致させる。
 *   - 単位は seed-materials.ts の同名カテゴリから取得（無指定は '本'）。
 *   - seed には在るが PDF に無い品目も在庫対象として残し、最も近い列・グループに配置する
 *     （末尾 KNOWN_DISCREPANCIES に列挙）。
 *   - categorySortOrder は seed-materials.ts の登録順（DB の MaterialCategory.sortOrder）に一致させる。
 *
 * 行の宣言順がそのまま PDF の (column 内) 表示順となる。
 * pdf.orderInGroup と itemSortOrder は build 時に自動採番（下の buildCatalog 参照）。
 */

/**
 * seed-materials.ts のカテゴリ登録順（= DB MaterialCategory.sortOrder）。
 * カタログの categorySortOrder はこの順序を唯一の正とする。
 *
 * 表記の正: catalog は PDF 表記を正とする（KNOWN_DISCREPANCIES #6）。
 *   そのため CATEGORY_ORDER も SPINE 側 categoryName（PDF 表記）に揃える。
 *   旧 'L型巾木（養用）'（seed 表記）は 'L型巾木(妻用)'（PDF 表記）に修正済み。
 *   これを揃えないと SPINE の 'L型巾木(妻用)' が CATEGORY_ORDER 未登録扱いとなり
 *   categorySortOrder が fallback（末尾）に静かに落ちる（本不変条件で検出）。
 */
export const CATEGORY_ORDER: readonly string[] = [
    '柱', '手摺', '400アンチ', '250ハーフ', 'センターハーフ', '筋交', 'ブラケット',
    'ピン付き', '階段', 'ジャッキ', '皿 / 兼用皿', 'ルーフベース', '単管', 'クランプ',
    '鉄骨', 'ジョイント', '単管ベース', 'ネット', 'カヤシート', 'ヒモ', '壁つなぎ',
    '道板', '巾木（木製）', 'L型巾木', 'L型巾木(妻用)', 'アダプター', 'ジャッキカバー',
    'コッパ', 'チョウチョ', '先行手摺', '梁枠', '安全バー', '金網', '杭',
    'ローリングタイヤ', 'ハッチ付きアンチ', 'タラップ', '朝顔', '単クランプ',
    '羽子板クランプ', '親綱', '足場表示看板', 'イメージシート', 'ラッセルネット',
    '階段手摺', 'レール', '養生カバー', '番線', '扉', 'リース品',
];

/**
 * seed-materials.ts 由来の単位マップ（カテゴリ名 -> 品目名 -> 単位）。
 * 省略されたものは '本'。PDF 表記と異なる品目は KNOWN_DISCREPANCIES の通り近似で対応。
 */
const SEED_UNITS: Record<string, Record<string, string>> = {
    '階段': { '鉄': '台', 'アルミ': '台', '3段': '台' },
    '皿 / 兼用皿': { '皿': '枚', '兼用皿': '枚' },
    'クランプ': { '直交': '個', '自在': '個', '3連': '個', 'シート': '個', '養生': '個' },
    '鉄骨': { '直交': '個', '自在': '個' },
    'ジョイント': { 'ジョイント': '個' },
    '単管ベース': { '単管ベース': '個' },
    'ネット': {
        // seed は全て '枚'
        '新築用 青(紐付) 1.8': '枚', 'グレー 5.4・6.3 1.2': '枚',
        '青 黒 緑 0.9': '枚', '白 0.6': '枚',
    },
    'カヤシート': { '1.8': '枚', '3.6': '枚' },
    'ヒモ': { 'ヒモ': '巻' },
    '道板': { '4m': '枚', '3m': '枚', '2m': '枚', '1m': '枚' },
    'アダプター': { '柱用': '個', 'アンチ': '個' },
    'ジャッキカバー': { 'ジャッキカバー': '個' },
    'チョウチョ': { 'チョウチョ': '個' },
    '金網': { '金網': '枚' },
    'ローリングタイヤ': { 'ローリングタイヤ': '個' },
    'ハッチ付きアンチ': { 'ハッチ付きアンチ': '枚' },
    'タラップ': { 'タラップ': '台' },
    '朝顔': { '朝顔': 'セット' },
    '単クランプ': { '単クランプ': '個' },
    '羽子板クランプ': { '羽子板クランプ': '個' },
    '親綱': { '親綱': 'm' },
    '足場表示看板': { '足場表示看板': '枚' },
    'イメージシート': { 'イメージシート': '枚' },
    'ラッセルネット': { 'ラッセルネット': '枚' },
    '養生カバー': { '大': '枚', '小': '枚' },
    '番線': { '巾木': '巻', '巻き': '巻' },
    '扉': { '扉': '枚' },
    'リース品': { 'リース品': '式' },
};

function unitFor(categoryName: string, itemName: string): string {
    return SEED_UNITS[categoryName]?.[itemName] ?? '本';
}

/**
 * PDF レイアウト準拠の列定義（背骨）。
 * categoryName は各 RawGroup の意味的カテゴリだが、PDF の空ラベルグループには
 * 複数カテゴリが混在するため、行単位で categoryName を持たせる。
 */
interface SpineRow { categoryName: string; itemName: string; spec: string }
interface SpineGroup { groupLabel: string; rows: SpineRow[] }
interface SpineColumn { column: PdfColumn; groups: SpineGroup[] }

const SPINE: SpineColumn[] = [
    {
        column: 'COL1',
        groups: [
            { groupLabel: '柱', rows: [
                { categoryName: '柱', itemName: '3.6m', spec: '3.6' },
                { categoryName: '柱', itemName: '2.7m', spec: '2.7' },
                { categoryName: '柱', itemName: '1.8m', spec: '1.8' },
                { categoryName: '柱', itemName: '0.9m', spec: '0.9' },
                { categoryName: '柱', itemName: '調整', spec: '調整' },
                { categoryName: '柱', itemName: '1コマ', spec: '1コマ' },
                { categoryName: '柱', itemName: '0.9切', spec: '0.9切' },
            ]},
            { groupLabel: '手摺', rows: [
                { categoryName: '手摺', itemName: '1.8m', spec: '1.8' },
                { categoryName: '手摺', itemName: '1.2m', spec: '1.2' },
                { categoryName: '手摺', itemName: '0.9m', spec: '0.9' },
                { categoryName: '手摺', itemName: '0.6m', spec: '0.6' },
                { categoryName: '手摺', itemName: '0.4m', spec: '0.4' },
                { categoryName: '手摺', itemName: '0.3m', spec: '0.3' },
                { categoryName: '手摺', itemName: '0.2m', spec: '0.2' },
                { categoryName: '手摺', itemName: 'サイド', spec: 'サイド' },
                { categoryName: '手摺', itemName: 'イボ0.6', spec: 'イボ0.6' },
            ]},
            { groupLabel: '400アンチ', rows: [
                { categoryName: '400アンチ', itemName: '1.8m', spec: '1.8' },
                { categoryName: '400アンチ', itemName: '1.2m', spec: '1.2' },
                { categoryName: '400アンチ', itemName: '0.9m', spec: '0.9' },
                { categoryName: '400アンチ', itemName: '0.6m', spec: '0.6' },
            ]},
            { groupLabel: '250ハーフ', rows: [
                { categoryName: '250ハーフ', itemName: '1.8m', spec: '1.8' },
                { categoryName: '250ハーフ', itemName: '1.2m', spec: '1.2' },
                { categoryName: '250ハーフ', itemName: '0.9m', spec: '0.9' },
                { categoryName: '250ハーフ', itemName: '0.6m', spec: '0.6' },
                { categoryName: '250ハーフ', itemName: '0.4m', spec: '0.4' },
            ]},
            { groupLabel: 'センターハーフ', rows: [
                { categoryName: 'センターハーフ', itemName: '1.8m', spec: '1.8' },
                { categoryName: 'センターハーフ', itemName: '1.2m', spec: '1.2' },
                { categoryName: 'センターハーフ', itemName: '0.9m', spec: '0.9' },
                { categoryName: 'センターハーフ', itemName: '0.6m', spec: '0.6' },
                // seed のみに存在する '0.4m' を在庫対象として末尾追加（KNOWN_DISCREPANCIES #4）
                { categoryName: 'センターハーフ', itemName: '0.4m', spec: '0.4' },
            ]},
            { groupLabel: '筋交', rows: [
                { categoryName: '筋交', itemName: '1.8m', spec: '1.8' },
                { categoryName: '筋交', itemName: '1.2m', spec: '1.2' },
                { categoryName: '筋交', itemName: '0.9m', spec: '0.9' },
            ]},
            { groupLabel: 'ブラケット', rows: [
                { categoryName: 'ブラケット', itemName: '0.6m', spec: '0.6' },
                { categoryName: 'ブラケット', itemName: '0.4m', spec: '0.4' },
                // seed のみに存在する '0.8m' を在庫対象として末尾追加（KNOWN_DISCREPANCIES #2）
                { categoryName: 'ブラケット', itemName: '0.8m', spec: '0.8' },
            ]},
            { groupLabel: 'ピン付き', rows: [
                { categoryName: 'ピン付き', itemName: '0.8m', spec: '0.8' },
                { categoryName: 'ピン付き', itemName: '0.6m', spec: '0.6' },
                { categoryName: 'ピン付き', itemName: '0.4m', spec: '0.4' },
                { categoryName: 'ピン付き', itemName: '0.2m', spec: '0.2' },
            ]},
            { groupLabel: '階段', rows: [
                { categoryName: '階段', itemName: '鉄', spec: '鉄' },
                { categoryName: '階段', itemName: 'アルミ', spec: 'アルミ' },
                { categoryName: '階段', itemName: '3段', spec: '3段' },
                { categoryName: '階段', itemName: '階段下', spec: '階段下' },
            ]},
            { groupLabel: 'ジャッキ', rows: [
                { categoryName: 'ジャッキ', itemName: '固定', spec: '固定' },
                { categoryName: 'ジャッキ', itemName: '下屋', spec: '下屋' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: '皿 / 兼用皿', itemName: '皿', spec: '皿' },
                { categoryName: '皿 / 兼用皿', itemName: '兼用皿', spec: '兼用皿' },
                { categoryName: 'ルーフベース', itemName: 'ルーフベース', spec: 'ルーフベース' },
            ]},
        ],
    },
    {
        column: 'COL2',
        groups: [
            { groupLabel: '単管', rows: [
                { categoryName: '単管', itemName: '6m', spec: '6m' },
                { categoryName: '単管', itemName: '5m', spec: '5m' },
                { categoryName: '単管', itemName: '4m', spec: '4m' },
                { categoryName: '単管', itemName: '3m', spec: '3m' },
                { categoryName: '単管', itemName: '2m', spec: '2m' },
                { categoryName: '単管', itemName: '1.5m', spec: '1.5m' },
                { categoryName: '単管', itemName: '1m', spec: '1m' },
                { categoryName: '単管', itemName: '0.5m', spec: '0.5m' },
            ]},
            { groupLabel: 'クランプ', rows: [
                { categoryName: 'クランプ', itemName: '直交', spec: '直交' },
                { categoryName: 'クランプ', itemName: '自在', spec: '自在' },
                { categoryName: 'クランプ', itemName: '3連', spec: '3連' },
                { categoryName: 'クランプ', itemName: 'シート', spec: 'シート' },
                { categoryName: 'クランプ', itemName: '養生', spec: '養生' },
            ]},
            { groupLabel: '鉄骨', rows: [
                { categoryName: '鉄骨', itemName: '直交', spec: '直交' },
                { categoryName: '鉄骨', itemName: '自在', spec: '自在' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: 'ジョイント', itemName: 'ジョイント', spec: 'ジョイント' },
                { categoryName: '単管ベース', itemName: '単管ベース', spec: '単管ベース' },
            ]},
            { groupLabel: '', rows: [
                // ネット: PDF の結合表記を自然キーとして採用（KNOWN_DISCREPANCIES #5 / SHEET_TYPES と別物）
                { categoryName: 'ネット', itemName: '新築用 青(紐付) 1.8', spec: '新築用 青(紐付) 1.8' },
                { categoryName: 'ネット', itemName: 'グレー 5.4・6.3 1.2', spec: 'グレー 5.4・6.3 1.2' },
                { categoryName: 'ネット', itemName: '青 黒 緑 0.9', spec: '青 黒 緑 0.9' },
                { categoryName: 'ネット', itemName: '白 0.6', spec: '白 0.6' },
            ]},
            { groupLabel: 'カヤシート', rows: [
                { categoryName: 'カヤシート', itemName: '1.8', spec: '1.8' },
                { categoryName: 'カヤシート', itemName: '3.6', spec: '3.6' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: 'ヒモ', itemName: 'ヒモ', spec: 'ヒモ' },
            ]},
            { groupLabel: '壁つなぎ', rows: [
                { categoryName: '壁つなぎ', itemName: '14～17', spec: '14～17' },
                { categoryName: '壁つなぎ', itemName: '19～24', spec: '19～24' },
                { categoryName: '壁つなぎ', itemName: '24～34', spec: '24～34' },
                { categoryName: '壁つなぎ', itemName: '33～52', spec: '33～52' },
                { categoryName: '壁つなぎ', itemName: '50～72', spec: '50～72' },
                { categoryName: '壁つなぎ', itemName: '70～92', spec: '70～92' },
            ]},
            { groupLabel: '道板', rows: [
                { categoryName: '道板', itemName: '4m', spec: '4m' },
                { categoryName: '道板', itemName: '3m', spec: '3m' },
                { categoryName: '道板', itemName: '2m', spec: '2m' },
                { categoryName: '道板', itemName: '1m', spec: '1m' },
            ]},
            { groupLabel: '巾木（木製）', rows: [
                { categoryName: '巾木（木製）', itemName: '4m', spec: '4m' },
                { categoryName: '巾木（木製）', itemName: '2m', spec: '2m' },
            ]},
            { groupLabel: 'L型巾木', rows: [
                { categoryName: 'L型巾木', itemName: '1.8m', spec: '1.8' },
                { categoryName: 'L型巾木', itemName: '1.2m', spec: '1.2' },
                { categoryName: 'L型巾木', itemName: '0.9m', spec: '0.9' },
                { categoryName: 'L型巾木', itemName: '0.6m', spec: '0.6' },
            ]},
            { groupLabel: 'L型巾木(妻用)', rows: [
                // PDF 表記は 'L型巾木(妻用)'。seed 表記は 'L型巾木（養用）'（KNOWN_DISCREPANCIES #6）
                { categoryName: 'L型巾木(妻用)', itemName: '0.9m', spec: '0.9' },
                { categoryName: 'L型巾木(妻用)', itemName: '0.6m', spec: '0.6' },
            ]},
            { groupLabel: 'アダプター', rows: [
                { categoryName: 'アダプター', itemName: '柱用', spec: '柱用' },
                { categoryName: 'アダプター', itemName: 'アンチ', spec: 'アンチ' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: 'ジャッキカバー', itemName: 'ジャッキカバー', spec: 'ジャッキカバー' },
                { categoryName: 'コッパ', itemName: 'コッパ', spec: 'コッパ' },
                { categoryName: 'チョウチョ', itemName: 'チョウチョ', spec: 'チョウチョ' },
            ]},
        ],
    },
    {
        column: 'COL3',
        groups: [
            { groupLabel: '先行手摺', rows: [
                { categoryName: '先行手摺', itemName: '1.8m', spec: '1.8' },
                { categoryName: '先行手摺', itemName: '1.2m', spec: '1.2' },
                { categoryName: '先行手摺', itemName: '0.9m', spec: '0.9' },
                { categoryName: '先行手摺', itemName: '0.6m', spec: '0.6' },
            ]},
            { groupLabel: '梁枠', rows: [
                { categoryName: '梁枠', itemName: '3.6m', spec: '3.6' },
                { categoryName: '梁枠', itemName: '5.4m', spec: '5.4' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: '安全バー', itemName: '安全バー', spec: '安全バー' },
                { categoryName: '金網', itemName: '金網', spec: '金網' },
                { categoryName: '杭', itemName: '杭', spec: '杭' },
                { categoryName: 'ローリングタイヤ', itemName: 'ローリングタイヤ', spec: 'ローリングタイヤ' },
                { categoryName: 'ハッチ付きアンチ', itemName: 'ハッチ付きアンチ', spec: 'ハッチ付きアンチ' },
                { categoryName: 'タラップ', itemName: 'タラップ', spec: 'タラップ' },
                { categoryName: '朝顔', itemName: '朝顔', spec: '朝顔' },
                { categoryName: '単クランプ', itemName: '単クランプ', spec: '単クランプ' },
                { categoryName: '羽子板クランプ', itemName: '羽子板クランプ', spec: '羽子板クランプ' },
                { categoryName: '親綱', itemName: '親綱', spec: '親綱' },
                { categoryName: '足場表示看板', itemName: '足場表示看板', spec: '足場表示看板' },
                { categoryName: 'イメージシート', itemName: 'イメージシート', spec: 'イメージシート' },
                { categoryName: 'ラッセルネット', itemName: 'ラッセルネット', spec: 'ラッセルネット' },
                { categoryName: '階段手摺', itemName: '階段手摺', spec: '階段手摺' },
                { categoryName: 'レール', itemName: 'レール', spec: 'レール' },
            ]},
            { groupLabel: '養生カバー', rows: [
                { categoryName: '養生カバー', itemName: '大', spec: '大' },
                { categoryName: '養生カバー', itemName: '小', spec: '小' },
            ]},
            { groupLabel: '番線', rows: [
                { categoryName: '番線', itemName: '巾木', spec: '巾木' },
                { categoryName: '番線', itemName: '巻き', spec: '巻き' },
            ]},
            { groupLabel: '', rows: [
                { categoryName: '扉', itemName: '扉', spec: '扉' },
                // seed のみに存在する 'リース品' を在庫対象として COL3 末尾に配置
                // （PDF はリース品を自由記述セクションで扱うため固定行が無い / KNOWN_DISCREPANCIES #7）
                { categoryName: 'リース品', itemName: 'リース品', spec: 'リース品' },
            ]},
        ],
    },
];

/** カテゴリ sortOrder（CATEGORY_ORDER 由来）。未登録カテゴリは末尾に回す。 */
function categorySortOrder(categoryName: string): number {
    const idx = CATEGORY_ORDER.indexOf(categoryName);
    return idx >= 0 ? idx : CATEGORY_ORDER.length + 1;
}

/**
 * 倉庫在庫の自動減算（Phase 3）対象から除外するカテゴリ集合。
 *
 * 根拠（ユーザー確定事項 / OPEN_DESIGN_TENSIONS T1・T2）:
 *   - 「ネット」（PDF の 4 結合品目: 例「新築用 青(紐付) 1.8」）/ シート / 「リース品」 の
 *     出庫数量は MaterialRequisition.notes の JSON（種類 × サイズ × 車両）が記録の「正」となる。
 *     これらを MaterialItem.stockQuantity からも自動減算すると notes-JSON と二重計上になるため除外する。
 *   - MaterialRequisitionItem.materialItemId（非 null FK）が MaterialItem 実在を要求するため、
 *     catalog 上にも該当品目は在庫対象 CatalogItem として残しつつ本フラグで減算対象からのみ外す。
 *   - Phase 3 の減算ロジック（lib/materials/stock.ts の統合 helper）は
 *     CatalogItem.excludeFromStockDecrement を必ず参照する（DB 列ミラーではなく
 *     この catalog が権威）。C6 で統合した loading-list/inventory 経路も同 helper 経由。
 *
 * 注記:
 *   - シート関連の語彙（7 種）は SHEET_TYPES として別 export（notes-JSON のキー用）であり、
 *     在庫対象 CatalogItem 側ではネット 4 結合品目が該当する。SHEET_TYPES 自体は変更しない。
 *   - 本プロジェクトの catalog では「シート」専用カテゴリは存在せず、シートはネット品目
 *     （categoryName === 'ネット'）として表現されている（KNOWN_DISCREPANCIES #5 参照）。
 */
const STOCK_DECREMENT_EXCLUDED_CATEGORIES = new Set<string>(['ネット', 'リース品']);

/** 当該品目を倉庫在庫の自動減算対象から除外するか（Phase 3 が参照する構造フラグの算出元） */
function isExcludedFromStockDecrement(categoryName: string): boolean {
    return STOCK_DECREMENT_EXCLUDED_CATEGORIES.has(categoryName);
}

/** SPINE から CatalogItem[] を構築（orderInGroup / itemSortOrder を自動採番） */
function buildCatalog(): CatalogItem[] {
    const items: CatalogItem[] = [];
    // カテゴリごとの品目連番（itemSortOrder）
    const itemSeqByCategory: Record<string, number> = {};

    for (const col of SPINE) {
        col.groups.forEach((group, groupIndex) => {
            group.rows.forEach((row, orderInGroup) => {
                const seq = itemSeqByCategory[row.categoryName] ?? 0;
                itemSeqByCategory[row.categoryName] = seq + 1;
                items.push({
                    categoryName: row.categoryName,
                    itemName: row.itemName,
                    specLabel: row.spec,
                    unit: unitFor(row.categoryName, row.itemName),
                    categorySortOrder: categorySortOrder(row.categoryName),
                    itemSortOrder: seq,
                    pdf: {
                        column: col.column,
                        groupIndex,
                        groupLabel: group.groupLabel,
                        orderInGroup,
                    },
                    initialStock: 0,
                    // ネット / シート / リース品は notes-JSON が出庫の正。
                    // 二重計上防止のため Phase 3 の在庫増減 helper（stock.ts）は
                    // この catalog フラグを権威として参照する（DB 列はミラー）。
                    excludeFromStockDecrement: isExcludedFromStockDecrement(row.categoryName),
                });
            });
        });
    }
    return items;
}

/** 全カタログ品目（自然キー: categoryName + itemName） */
export const CATALOG_ITEMS: CatalogItem[] = buildCatalog();

/** 全カタログカテゴリ（出現順 / sortOrder = CATEGORY_ORDER 由来） */
export const CATALOG_CATEGORIES: CatalogCategory[] = (() => {
    const seen = new Set<string>();
    const cats: CatalogCategory[] = [];
    for (const it of CATALOG_ITEMS) {
        if (seen.has(it.categoryName)) continue;
        seen.add(it.categoryName);
        cats.push({ name: it.categoryName, sortOrder: categorySortOrder(it.categoryName) });
    }
    cats.sort((a, b) => a.sortOrder - b.sortOrder);
    return cats;
})();

/* ============================================================================
 * Phase 2: PDF / 入力フォーム生成用レイアウト（catalog を単一の正とする）
 *
 * これまで MaterialRequisitionSlipPDF.tsx に COL1/COL2/COL3 がハードコードされ、
 * catalog.ts と二重定義になっていた。Phase 2 で PDF / 印刷経路 /
 * ライブプレビューは下記 PDF_LAYOUT（CATALOG_ITEMS から生成）を唯一の正とする。
 * 行順 / グループ / spec ラベルは従来の PDF と完全一致するよう
 * pdf.column / pdf.groupIndex / pdf.groupLabel / pdf.orderInGroup から再構築する。
 * ========================================================================== */

/** PDF レイアウトの 1 行（旧 COLn の Row 相当） */
export interface PdfLayoutRow {
    /** spec 表示ラベル（旧 Row.spec / specLabel と一致） */
    spec: string;
    categoryName: string;
    itemName: string;
}

/** PDF レイアウトの 1 グループ（旧 COLn の Group 相当） */
export interface PdfLayoutGroup {
    /** グループラベル（'' はラベル無しグループ） */
    label: string;
    rows: PdfLayoutRow[];
}

/** PDF レイアウトの 1 列（旧 COLn 配列相当） */
export interface PdfLayoutColumn {
    column: PdfColumn;
    groups: PdfLayoutGroup[];
}

/**
 * CATALOG_ITEMS から PDF 3 列レイアウトを生成する（単一の正）。
 *
 * - 列順は COL1 → COL2 → COL3 固定。
 * - 列内グループは pdf.groupIndex 昇順（ラベル無しグループも別ブロックとして保持）。
 * - グループ内行は pdf.orderInGroup 昇順。
 * - spec は CatalogItem.specLabel を採用（旧 PDF の Row.spec と一致）。
 */
export function buildPdfLayout(items: CatalogItem[] = CATALOG_ITEMS): PdfLayoutColumn[] {
    const columnOrder: PdfColumn[] = ['COL1', 'COL2', 'COL3'];
    return columnOrder.map((column) => {
        const colItems = items.filter((it) => it.pdf.column === column);
        // groupIndex でグルーピング
        const byGroup = new Map<number, CatalogItem[]>();
        for (const it of colItems) {
            const arr = byGroup.get(it.pdf.groupIndex) ?? [];
            arr.push(it);
            byGroup.set(it.pdf.groupIndex, arr);
        }
        const groups: PdfLayoutGroup[] = Array.from(byGroup.keys())
            .sort((a, b) => a - b)
            .map((gi) => {
                const rows = byGroup
                    .get(gi)!
                    .slice()
                    .sort((a, b) => a.pdf.orderInGroup - b.pdf.orderInGroup);
                return {
                    label: rows[0]?.pdf.groupLabel ?? '',
                    rows: rows.map((r) => ({
                        spec: r.specLabel,
                        categoryName: r.categoryName,
                        itemName: r.itemName,
                    })),
                };
            });
        return { column, groups };
    });
}

/** PDF レイアウト（PDF / 印刷 / ライブプレビュー共通の単一の正） */
export const PDF_LAYOUT: PdfLayoutColumn[] = buildPdfLayout();

/* ============================================================================
 * Phase 2: シート（ネット）/ 自由欄の notes-JSON 構造
 *
 * 出庫伝票のシート（SHEET_TYPES 7 種）数量・汎用自由欄を
 * MaterialRequisition.notes に JSON で保存する。
 *   - 旧プレーン notes（自由テキスト）は後方互換で memo として読む。
 *   - vehicleInfo と同じく try/parse の後方互換パターンで扱う。
 * ========================================================================== */

/** シートのサイズ軸（4 行 / PDF・フォーム共通） */
export const SHEET_SIZES = ['1.8', '1.2', '0.9', '0.6'] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];

/** シート 1 種類ぶんの数量（サイズ × 車両3列） */
export interface SheetEntry {
    /** SHEET_TYPES のいずれか（複数選択された種類のみ持つ） */
    type: SheetType;
    /**
     * size -> [車両0, 車両1, 車両2] の数量。
     * 0 は空欄扱い。未入力の size は省略可。
     */
    sizes: Partial<Record<SheetSize, [number, number, number]>>;
}

/** 汎用「その他自由欄」1 行 */
export interface FreeFormEntry {
    label: string;
    /** [車両0, 車両1, 車両2] の数量文字列（自由記述許容のため string） */
    qty: [string, string, string];
}

/**
 * MaterialRequisition.notes に保存する構造化 JSON。
 * 旧データ（プレーン文字列）との互換は parseRequisitionNotes が吸収する。
 */
export interface RequisitionNotes {
    /** スキーマ判別用バージョン（後方互換のため将来増やせる） */
    v: 1;
    /** 旧 notes 相当の自由メモ（プレーン文字列の移行先） */
    memo: string;
    /** シート（種類 × サイズ × 車両）。複数種類を選択可能 */
    sheets: SheetEntry[];
    /** 汎用自由欄（種別に無い任意品目） */
    freeForm: FreeFormEntry[];
    /**
     * 記入者名（出庫伝票を記入した人。施工班=foremanName とは別軸）。
     * スキーマ変更不要のため notes-JSON に持つ（v:1 のまま追加・後方互換）。
     */
    writerName?: string;
    /** 組立日（YYYY-MM-DD / 空欄可）。PDF はこの値を ProjectAssignment より優先表示 */
    assemblyDate?: string;
    /** 解体日（YYYY-MM-DD / 空欄可）。PDF はこの値を ProjectAssignment より優先表示 */
    demolitionDate?: string;
}

/** 空の RequisitionNotes */
export function emptyRequisitionNotes(): RequisitionNotes {
    return { v: 1, memo: '', sheets: [], freeForm: [], writerName: '', assemblyDate: '', demolitionDate: '' };
}

/** 1 要素を有限数に矯正（NaN / Infinity / 非数 → 0、負値も 0 にクランプ） */
function toFiniteQty(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * SheetEntry.sizes を形状正規化する。
 * 各 size のタプルを「長さ 3・各要素 finite number」に矯正し
 * （不正・欠損は 0 埋め）、SHEET_SIZES に無いキーは捨てる。
 * 破損データ / 旧形式（長さ不足・文字列数量）の混入耐性。
 */
function normalizeSheetSizes(
    raw: unknown,
): Partial<Record<SheetSize, [number, number, number]>> {
    const out: Partial<Record<SheetSize, [number, number, number]>> = {};
    if (!raw || typeof raw !== 'object') return out;
    const rec = raw as Record<string, unknown>;
    for (const size of SHEET_SIZES) {
        if (!(size in rec)) continue;
        const t = rec[size];
        const arr = Array.isArray(t) ? t : [];
        out[size] = [toFiniteQty(arr[0]), toFiniteQty(arr[1]), toFiniteQty(arr[2])];
    }
    return out;
}

/** SheetEntry の sizes が全て 0 か（保存時の間引き判定用） */
function sheetEntryIsEmpty(e: SheetEntry): boolean {
    return !Object.values(e.sizes).some(
        (t) => Array.isArray(t) && (t[0] > 0 || t[1] > 0 || t[2] > 0),
    );
}

/** FreeFormEntry が空か */
function freeFormIsEmpty(e: FreeFormEntry): boolean {
    return (
        !e.label.trim() &&
        !(e.qty[0]?.trim() || e.qty[1]?.trim() || e.qty[2]?.trim())
    );
}

/**
 * notes 文字列を RequisitionNotes に正規化（後方互換）。
 *   - JSON かつ v:1 形式 → そのまま採用（欠損フィールドは補完）
 *   - それ以外（旧プレーンテキスト / null）→ memo に格納
 */
export function parseRequisitionNotes(raw: string | null | undefined): RequisitionNotes {
    const base = emptyRequisitionNotes();
    if (!raw) return base;
    try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && obj.v === 1) {
            return {
                v: 1,
                memo: typeof obj.memo === 'string' ? obj.memo : '',
                sheets: Array.isArray(obj.sheets)
                    ? (obj.sheets as SheetEntry[])
                          .filter(
                              (s) =>
                                  s &&
                                  (SHEET_TYPES as readonly string[]).includes(s.type) &&
                                  s.sizes && typeof s.sizes === 'object',
                          )
                          // sizes を長さ3・finite number タプルに形状正規化（不正は0埋め）
                          .map((s) => ({
                              type: s.type,
                              sizes: normalizeSheetSizes(s.sizes),
                          }))
                    : [],
                freeForm: Array.isArray(obj.freeForm)
                    ? (obj.freeForm as FreeFormEntry[])
                          .filter((f) => f && typeof f === 'object')
                          .map((f) => ({
                              label: String(f.label ?? ''),
                              qty: [
                                  String(f.qty?.[0] ?? ''),
                                  String(f.qty?.[1] ?? ''),
                                  String(f.qty?.[2] ?? ''),
                              ] as [string, string, string],
                          }))
                    : [],
                writerName: typeof obj.writerName === 'string' ? obj.writerName : '',
                assemblyDate: typeof obj.assemblyDate === 'string' ? obj.assemblyDate : '',
                demolitionDate: typeof obj.demolitionDate === 'string' ? obj.demolitionDate : '',
            };
        }
        // JSON だが想定外形式 → 文字列として memo に
        return { ...base, memo: raw };
    } catch {
        // 旧プレーン notes
        return { ...base, memo: raw };
    }
}

/**
 * RequisitionNotes を保存用文字列にシリアライズ。
 *   - 空メモ / シート無し / 自由欄無し（全空）の場合は null を返す
 *     （旧来の「notes 無し」と同じ扱い・DB を汚さない）。
 *   - memo のみで sheets / freeForm が空でも、構造を保つため JSON で保存する
 *     （次回読込時に確実に v:1 として解釈させ、プレーン誤認を防ぐ）。
 */
export function serializeRequisitionNotes(n: RequisitionNotes): string | null {
    const sheets = n.sheets.filter((s) => !sheetEntryIsEmpty(s));
    const freeForm = n.freeForm.filter((f) => !freeFormIsEmpty(f));
    const memo = n.memo ?? '';
    const writerName = (n.writerName ?? '').trim();
    const assemblyDate = (n.assemblyDate ?? '').trim();
    const demolitionDate = (n.demolitionDate ?? '').trim();
    if (
        !memo.trim() && sheets.length === 0 && freeForm.length === 0 &&
        !writerName && !assemblyDate && !demolitionDate
    ) {
        return null;
    }
    return JSON.stringify({ v: 1, memo, sheets, freeForm, writerName, assemblyDate, demolitionDate });
}

/**
 * 自然キー文字列（seed / upsert の内部突き合わせ専用）。
 *
 * 注意: これは catalog ⇔ DB の seed 内部突合せ用キーであり、
 *       実行時（出庫伝票の入力/プレビュー）のキーとは別物。
 *       実行時キーは print/form 側で `|` 区切り（categoryName|itemName|vehicleIndex）であり、
 *       lib/pdf/materialRequisitionPrint.tsx の `${cat}|${name}|${idx}` /
 *       components/Materials/MaterialRequisitionPage.tsx の getQty 契約で使われる。
 *       本関数の区切り（半角スペース）を実行時ルックアップに流用しないこと。
 */
export function naturalKey(categoryName: string, itemName: string): string {
    return `${categoryName} ${itemName}`;
}

/** 列ごとの品目数（検証・レポート用） */
export function countByColumn(): Record<PdfColumn, number> {
    const acc: Record<PdfColumn, number> = { COL1: 0, COL2: 0, COL3: 0 };
    for (const it of CATALOG_ITEMS) acc[it.pdf.column] += 1;
    return acc;
}

/**
 * --- KNOWN_DISCREPANCIES ---
 * seed-materials.ts と MaterialRequisitionSlipPDF.tsx の表記差異（catalog は PDF 表記を正に採用）:
 *   #1 ネット「新素用」 -> 「新築用」に修正（SHEET_TYPES / ネット品目とも）
 *   #2 ブラケット: seed=[0.4m,0.8m,0.6m] / PDF=[0.6m,0.4m]
 *      -> PDF 順を採用しつつ seed 専用 '0.8m' を在庫対象として末尾追加
 *   #3 ピン付き: seed=[0.4m,0.2m] / PDF=[0.8m,0.6m,0.4m,0.2m] -> PDF（superset）を採用
 *   #4 センターハーフ: seed=[0.4m,1.8m,1.2m,0.9m,0.6m] / PDF=[1.8m,1.2m,0.9m,0.6m]
 *      -> PDF 順を採用しつつ seed 専用 '0.4m' を在庫対象として末尾追加
 *   #5 ネット品目名: seed=[新築用 青(紐付),グレー5.4,グレー6.3,青,黒,緑,白]（7 個別品目）
 *      / PDF=[新築用 青(紐付) 1.8, グレー 5.4・6.3 1.2, 青 黒 緑 0.9, 白 0.6]（4 結合品目）
 *      -> 実行時ルックアップ契約 (PDF) を正とし PDF の 4 結合品目を採用。
 *         「種類」軸の 7 値は SHEET_TYPES として別途 export（notes-JSON 用 / OPEN_DESIGN_TENSIONS 参照）
 *   #6 L型巾木（養用）(seed) ⇔ L型巾木(妻用)(PDF) -> PDF 表記を正に採用
 *   #7 リース品: PDF は固定行を持たず自由記述セクション。seed には品目あり
 *      -> 在庫対象として COL3 末尾に固定行追加
 *   #8 250ハーフ: seed=[1.2m,0.9m,0.6m] / PDF=[1.8m,1.2m,0.9m,0.6m,0.4m] -> PDF（superset）を採用
 *   #9 カヤシート: seed=[カヤシート] / PDF=[1.8,3.6] -> PDF を正に採用
 *
 * --- OPEN_DESIGN_TENSIONS ---
 *   T1【決着】: ネット / シート / リース品は notes-JSON が正・在庫減算対象外
 *       決定: ネット / シート / リース品は CatalogItem.excludeFromStockDecrement = true とし、
 *       倉庫在庫（MaterialItem.stockQuantity）の自動増減対象から除外する。
 *       出庫数量の「正」は MaterialRequisition.notes の JSON
 *       （種類(SHEET_TYPES) × サイズ × 車両）であり、MaterialItem 在庫からは減算しない
 *       （二重計上の防止）。Phase 3 の在庫増減 helper（lib/materials/stock.ts の
 *       applyStockChange）はこの catalog フラグを権威として参照し、true の品目は
 *       減算をスキップする。C6 で統合した loading-list/confirm・inventory 棚卸し
 *       経路も同一 helper を経由するため判定は一元化（DB 列ミラーは参照しない）。
 *       MaterialRequisitionItem.materialItemId（非 null FK）が MaterialItem 実在を
 *       要求するため catalog 上には在庫対象 CatalogItem として残し、
 *       SHEET_TYPES（7 種）は notes-JSON のキー語彙として併存させる。
 *
 *   T2【決着】: リース品の在庫減算
 *       決定: リース品も T1 と同方針。CatalogItem.excludeFromStockDecrement = true とし、
 *       倉庫在庫の自動増減対象外。数量は notes-JSON を記録の「正」とする。
 *       Phase 3 の helper（stock.ts）は本 catalog フラグ参照で減算をスキップする
 *       （DB 列はミラー / WHERE 強制基盤）。
 */
