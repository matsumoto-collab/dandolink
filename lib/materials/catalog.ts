/**
 * 材料カタログ（コード上の単一の正 / single source of truth）
 *
 * このファイルは在庫管理リワークの土台です。
 * 将来 (Phase 2 以降) は以下の両方をここから生成します:
 *   1. 出庫伝票 PDF (components/pdf/MaterialRequisitionSlipPDF.tsx) の 3 列レイアウト
 *   2. 出庫伝票 入力フォーム
 * Phase 1 では「定義」と「冪等 seed」「構造検証」のみを行い、
 * PDF / フォーム側の生成への切替は行いません（既存の表示系は無変更）。
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
 * --- シート（ネット）について ---
 *   ネット / シートも物理在庫であり在庫減算対象になり得る。
 *   ただし出庫伝票上のシート数量は将来 MaterialRequisition.notes の JSON に
 *   「種類 × サイズ × 車両」で保存する設計テンションが存在する（Phase 1 では未解決）。
 *   本 catalog ではネット / シート品目も在庫対象 (CatalogItem) として表現しつつ、
 *   notes-JSON と MaterialItem 在庫減算の整合方針は Phase 2/3 の論点として TODO に残す。
 *   （末尾 OPEN_DESIGN_TENSIONS を参照）
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
 */
const CATEGORY_ORDER: string[] = [
    '柱', '手摺', '400アンチ', '250ハーフ', 'センターハーフ', '筋交', 'ブラケット',
    'ピン付き', '階段', 'ジャッキ', '皿 / 兼用皿', 'ルーフベース', '単管', 'クランプ',
    '鉄骨', 'ジョイント', '単管ベース', 'ネット', 'カヤシート', 'ヒモ', '壁つなぎ',
    '道板', '巾木（木製）', 'L型巾木', 'L型巾木（養用）', 'アダプター', 'ジャッキカバー',
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

/** 自然キー文字列（seed / upsert で使用） */
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
 * --- OPEN_DESIGN_TENSIONS（Phase 1 では未解決 / Phase 2/3 で決定）---
 *   T1: シート（ネット）数量の保存先 vs 在庫減算
 *       将来、出庫伝票のシート数量は MaterialRequisition.notes の JSON に
 *       「種類(SHEET_TYPES) × サイズ × 車両」で保存する方針。
 *       一方でシートも物理在庫であり MaterialItem 在庫減算の対象になり得る。
 *       notes-JSON 上のシート数量と MaterialItem.stockQuantity の整合
 *       （どちらを在庫の正とするか / 二重計上の防止）は Phase 2/3 で決定する。
 *       Phase 1 の暫定: ネット品目（PDF 4 結合品目）を在庫対象として表現しつつ、
 *       SHEET_TYPES（7 種）を notes-JSON のキー語彙として併存させる。
 */
