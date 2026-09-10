/**
 * 材料管理表エクセル（デスクトップ 🈟材料管理表.xlsx）と DB 品目マスタの対応表。
 *
 * この 1 ファイルが「エクセルのどの行が DB のどの品目か」の単一の正。
 * マスタ整備スクリプト（scripts/setup-stocktake-master.ts）と
 * 過去データ取込スクリプト（scripts/import-stocktake-excel.ts）の両方がここを参照する。
 *
 * --- エクセルの構造 ---
 *   シート「土場」   : 通常足場の材料 / 置き場所 = 土場   / A 列 = 品名, B 列 = サイズ
 *   シート「ロック」 : ロック足場の材料 / 置き場所 = 土場（ロックは工法であって場所ではない = kei 確認済み）
 *   シート「上野」   : 通常足場の材料 / 置き場所 = 上野
 *   シート「土場材料表」: 棚卸用の白紙チェックシート（データではないので取り込まない）
 *
 *   1 行目が列見出しで、日付の入った列 = その日に数えた実地棚卸の結果。
 *   A 列は結合セルなので、値が無い行は直前の行の品名を引き継ぐ。
 *
 * --- 突き合わせの根拠 ---
 *   DB の MaterialItem.stockQuantity は 2026-07-29 に土場シートの最終列（2026-07-28）を
 *   手入力したもので、下記の対応で数値が一致することを確認済み。
 *     柱 3.6      : Excel 3895 = DB 3895
 *     手摺 1.8    : Excel 3450 = DB 3450
 *     ブラケット 0.6 : Excel 5150 = DB 5150
 *     ピン付き 大  : Excel 137  = DB「ピン付き 0.6m」137   ← 大/小/200 は 0.6/0.4/0.2 の別表記
 *     メッシュシート(グレー) 1.8 : Excel 300 = DB「新築用 グレー(紐付) 1.8」300
 *     メッシュシート(黒) 1.8    : Excel 200 = DB「黒 1.8」200
 */

/** 工法区分。MaterialItem.scaffoldMethod / Stocktake.scaffoldMethod と同じ値 */
export type ScaffoldMethod = 'standard' | 'lock';

/** エクセルのシート名 */
export type SheetName = '土場' | 'ロック' | '上野';

/** シート = 置き場所 × 工法 */
export interface SheetSource {
    sheet: SheetName;
    /** StorageLocation.name */
    locationName: string;
    method: ScaffoldMethod;
    /**
     * 日付列の見出しに日付が入っていない列の読み替え。
     * 土場シートの D 列は見出しが文字列「3/1開始」で、2023-03-01 時点の数を表す。
     */
    literalDateColumns?: { column: string; date: string }[];
    /**
     * 日付ではない集計列（取り込まない）。ロック C=購入数 / D=残合計、上野 C=残合計。
     * D「残合計」は日付が特定できないため既定では取り込まず、
     * 取込スクリプトの --lock-total-date で日付を指定したときだけ 1 回分の棚卸として扱う。
     */
    aggregateColumns?: { column: string; label: string }[];
    /** 見出しの日付が明らかに打ち間違いの列を正しい日付に直す */
    dateOverrides?: { column: string; wrongDate: string; date: string; reason: string }[];
}

export const SHEET_SOURCES: SheetSource[] = [
    {
        sheet: '土場',
        locationName: '土場',
        method: 'standard',
        literalDateColumns: [{ column: 'D', date: '2023-03-01' }],
        aggregateColumns: [{ column: 'C', label: '購入数202509時点' }],
    },
    {
        sheet: 'ロック',
        locationName: '土場',
        method: 'lock',
        aggregateColumns: [
            { column: 'C', label: '購入数202509時点' },
            { column: 'D', label: '残合計' },
        ],
        dateOverrides: [
            {
                // ロックシートの日付列は土場シートと 1 対 1 で対応している:
                //   ロック E〜I = 土場 F〜K（2023-04-01 / 05-10 / 06-20 / 07-13 / 08-19）
                //   ロック K〜N = 土場 M / N / P / Q（2024-02-14 / 04-20 / 05-29 / 10-14）
                // その並びで J だけが土場 L（2023-10-30）に当たるのに 2024-10-30 と入っており、
                // 右隣の K（2024-02-14）より後の日付になっていて並びも崩れている。
                // 年の打ち間違いと判断して直す。
                column: 'J',
                wrongDate: '2024-10-30',
                date: '2023-10-30',
                reason: '土場シートの対応列（2023-10-30）と年がずれている打ち間違い',
            },
        ],
    },
    {
        sheet: '上野',
        locationName: '上野',
        method: 'standard',
        aggregateColumns: [{ column: 'C', label: '残合計' }],
    },
];

/** DB 側の品目の指し先 */
export interface DbItemRef {
    /** MaterialCategory.name */
    category: string;
    /** MaterialItem.name */
    item: string;
}

/** 対応表の 1 行 */
export interface SheetItemMapping extends DbItemRef {
    /** エクセル A 列（品名） */
    excelCategory: string;
    /** エクセル B 列（サイズ）。A 列と同じ値のこともある */
    excelSpec: string;
    /** この品目が属する工法 */
    method: ScaffoldMethod;
    /** MaterialItem.spec（表示用のサイズラベル） */
    spec: string;
    /** MaterialItem.unit */
    unit: string;
    /** true = DB にまだ無いので新規作成が必要 */
    isNew?: boolean;
    /**
     * true = 過去データの取込のためだけに作る品目。isActive=false で作成し、
     * これからの棚卸の入力欄には出さない（例: もう使っていない「古い青」のシート）。
     */
    archiveOnly?: boolean;
    /** 判断の根拠や kei への申し送り */
    note?: string;
}

/** サイズだけが違う品目をまとめて作るための小道具 */
function sizes(
    excelCategory: string,
    dbCategory: string,
    specs: string[],
    opts: { method?: ScaffoldMethod; unit?: string; itemSuffix?: string; isNew?: boolean; note?: string } = {},
): SheetItemMapping[] {
    const { method = 'standard', unit = '本', itemSuffix = 'm', isNew, note } = opts;
    return specs.map((s) => ({
        excelCategory,
        excelSpec: s,
        category: dbCategory,
        item: `${s}${itemSuffix}`,
        method,
        spec: s,
        unit,
        isNew,
        note,
    }));
}

/** 1 品目しか無いカテゴリ（サイズ欄が品名と同じもの）用 */
function single(
    excelCategory: string,
    dbCategory: string,
    opts: { excelSpec?: string; item?: string; method?: ScaffoldMethod; unit?: string; isNew?: boolean; note?: string } = {},
): SheetItemMapping {
    const { excelSpec = excelCategory, item = dbCategory, method = 'standard', unit = '本', isNew, note } = opts;
    return { excelCategory, excelSpec, category: dbCategory, item, method, spec: item, unit, isNew, note };
}

/** メッシュシート（エクセルの色別）→ DB「シート」カテゴリの色付き品目名 */
function meshSheet(
    excelColor: string,
    dbColorPrefix: string,
    opts: { isNew?: boolean; archiveOnly?: boolean; note?: string } = {},
): SheetItemMapping[] {
    return ['1.8', '1.2', '0.9', '0.6'].map((s) => ({
        excelCategory: `メッシュシート(${excelColor})`,
        excelSpec: s,
        category: 'シート',
        item: `${dbColorPrefix} ${s}`,
        method: 'standard' as const,
        spec: s,
        unit: '枚',
        isNew: opts.isNew,
        archiveOnly: opts.archiveOnly,
        note: opts.note,
    }));
}

/**
 * 通常足場（土場 / 上野シート）の対応表。
 * 上野シートは土場シートと同じ品名・同じ並びなので同じ対応表を使う。
 */
export const STANDARD_MAPPINGS: SheetItemMapping[] = [
    ...sizes('柱', '柱', ['3.6', '2.7', '1.8', '0.9']),
    single('柱', '柱', { excelSpec: '調整', item: '調整' }),
    single('柱', '柱', { excelSpec: '1コマ', item: '1コマ' }),

    ...sizes('手摺', '手摺', ['1.8', '1.2', '0.9', '0.6', '0.4', '0.3', '0.2']),
    single('手摺', '手摺', { excelSpec: 'サイド', item: 'サイド' }),
    single('手摺', '手摺', { excelSpec: 'イボ0.6', item: 'イボ0.6' }),

    ...sizes('400アンチ', '400アンチ', ['1.8', '1.2', '0.9', '0.6']),
    ...sizes('250ハーフ', '250ハーフ', ['1.8', '1.2', '0.9', '0.6', '0.4']),
    ...sizes('センターハーフ', 'センターハーフ', ['1.8', '1.2', '0.9', '0.6']),
    ...sizes('筋交', '筋交', ['1.8', '1.2', '0.9']),

    // エクセル A 列は前後に全角スペースが入っている（読み取り時に trim する）
    ...sizes('ブラケット', 'ブラケット', ['0.6', '0.4', '0.8']),

    // 大 / 小 / 200 は 0.6 / 0.4 / 0.2 の別表記（2026-07-28 の数量一致で確認）
    { excelCategory: 'ピン付き', excelSpec: '大', category: 'ピン付き', item: '0.6m', method: 'standard', spec: '0.6', unit: '本', note: 'エクセルの「大」= 0.6m' },
    { excelCategory: 'ピン付き', excelSpec: '小', category: 'ピン付き', item: '0.4m', method: 'standard', spec: '0.4', unit: '本', note: 'エクセルの「小」= 0.4m' },
    { excelCategory: 'ピン付き', excelSpec: '200', category: 'ピン付き', item: '0.2m', method: 'standard', spec: '0.2', unit: '本', note: 'エクセルの「200」= 0.2m' },

    single('階段', '階段', { excelSpec: '鉄', item: '鉄', unit: '台' }),
    single('階段', '階段', { excelSpec: 'アルミ', item: 'アルミ', unit: '台' }),
    single('階段', '階段', { excelSpec: '内づめ', item: '内づめ', unit: '基' }),
    single('階段', '階段', { excelSpec: '3段', item: '3段', unit: '台' }),
    single('階段', '階段', { excelSpec: '階段下', item: '階段下' }),

    single('ジャッキ', 'ジャッキ', { excelSpec: '固定', item: '固定' }),
    single('ジャッキ', 'ジャッキ', { excelSpec: '下屋', item: '下屋' }),

    single('皿', '皿 / 兼用皿', { item: '皿', unit: '枚' }),
    single('兼用皿', '皿 / 兼用皿', { item: '兼用皿', unit: '枚' }),
    single('ルーフベース', 'ルーフベース'),

    single('アダプター', 'アダプター', { excelSpec: '柱用', item: '柱用', unit: '個' }),
    single('アダプター', 'アダプター', { excelSpec: 'アンチ', item: 'アンチ', unit: '個' }),
    single('ジャッキカバー', 'ジャッキカバー', { unit: '個' }),

    ...sizes('先行手摺', '先行手摺', ['1.8', '1.2', '0.9', '0.6']),
    ...sizes('梁枠', '梁枠', ['3.6', '5.4']),

    single('安全バー', '安全バー'),
    single('金網', '金網', { unit: '枚' }),
    single('ハッチ付きアンチ', 'ハッチ付きアンチ', { unit: '枚' }),
    single('タラップ', 'タラップ', { unit: '台' }),
    single('階段手摺', '階段手摺'),
    single('レール', 'レール'),
    single('親綱', '親綱', { unit: 'm' }),

    // DB は「扉」1 品目だが、エクセルは 普 / 大 の 2 種類で数えている
    { excelCategory: '扉', excelSpec: '普', category: '扉', item: '普', method: 'standard', spec: '普', unit: '枚', isNew: true, note: '既存の「扉/扉」を 普・大 の 2 品目に分ける' },
    { excelCategory: '扉', excelSpec: '大', category: '扉', item: '大', method: 'standard', spec: '大', unit: '枚', isNew: true },

    ...meshSheet('緑', '緑'),
    ...meshSheet('グレー', '新築用 グレー(紐付)'),
    ...meshSheet('黒', '黒'),
    ...meshSheet('先行用青', '新築用 青(紐付)', { note: 'エクセル「先行用青」= DB「新築用 青(紐付)」と判断（要 kei 確認）' }),
    {
        excelCategory: 'メッシュシート(先行用青)', excelSpec: '400巾', category: 'シート', item: '新築用 青(紐付) 400巾',
        method: 'standard', spec: '400巾', unit: '枚', isNew: true,
    },
    ...meshSheet('古い青', '古い青', { isNew: true, archiveOnly: true, note: '2023-04 で更新停止。過去データ保持のためだけに作り、棚卸の入力欄には出さない' }),

    single('クランプ', 'クランプ', { excelSpec: '直交', item: '直交', unit: '個' }),
    single('クランプ', 'クランプ', { excelSpec: '自在', item: '自在', unit: '個' }),
    single('クランプ', 'クランプ', { excelSpec: 'シート', item: 'シート', unit: '個' }),

    ...sizes('単管', '単管', ['6m', '5m', '4m', '3m', '2m', '1m'], { itemSuffix: '' }),

    single('マルチカバー', 'マルチカバー', { unit: '枚', isNew: true }),
    single('先無し小ブラ', '先無し小ブラ', { isNew: true }),
    single('ラッシング', 'ラッシング', { unit: '本', isNew: true, note: '上野シートのみ' }),
    single('ロープ', 'ロープ', { unit: '本', isNew: true, note: '上野シートのみ' }),

    // 壁繋ぎ: エクセルはサイズを分けずに "many" とだけ書かれており数量が無い。
    // DB は 14～17 / 19～24 … の 6 サイズ。対応が取れないので取り込み対象外にする。
];

/**
 * ロック足場（ロックシート）の対応表。
 * ロック足場の材料は DB にほぼ無いので大半が新規作成になる。
 */
export const LOCK_MAPPINGS: SheetItemMapping[] = [
    ...sizes('ロック手摺', 'ロック手摺', ['1.8', '1.2', '0.9', '0.6', '0.4', '0.3', '0.2'], { method: 'lock', isNew: true }),
    single('ロック手摺', 'ロック手摺', { excelSpec: 'サイド', item: 'サイド', method: 'lock', isNew: true }),
    single('ロック手摺', 'ロック手摺', { excelSpec: 'イボ0.6', item: 'イボ0.6', method: 'lock', isNew: true }),

    ...sizes('500アンチ', '500アンチ', ['1.8', '1.2', '0.9', '0.6'], { method: 'lock', isNew: true }),

    // L型巾木 / 妻側巾木 は土場シートに無くロックシートにしか出てこない = ロック足場の材料
    ...sizes('L型巾木', 'L型巾木', ['1.8', '1.2', '0.9', '0.6'], { method: 'lock' }),
    { excelCategory: 'L型巾木', excelSpec: '0.4', category: 'L型巾木', item: '0.4m', method: 'lock', spec: '0.4', unit: '本', isNew: true },
    ...sizes('妻側巾木', 'L型巾木(妻用)', ['0.9', '0.6'], { method: 'lock' }),

    ...sizes('ロックブラケット', 'ロックブラケット', ['0.6', '0.4', '0.8'], { method: 'lock', isNew: true }),
    ...sizes('ロックピン付き', 'ロックピン付き', ['0.6', '0.4', '0.2'], { method: 'lock', isNew: true }),
    ...sizes('梁枠(ロック)', '梁枠(ロック)', ['3.6', '5.4', '7.2'], { method: 'lock', isNew: true }),

    // 「階段手摺」は土場シートにもあり、そちらは通常足場用。ロック用は別品目として持つ
    single('階段手摺', 'ロック階段手摺', { method: 'lock', isNew: true, note: '土場シートの「階段手摺」とは別物。ロックシートにしか出てこない' }),
    single('ロック階段', 'ロック階段', { method: 'lock', unit: '台', isNew: true }),
    single('朝顔', '朝顔', { method: 'lock', unit: 'セット', note: 'ロックシートにしか出てこないので lock 側に寄せる（要 kei 確認）' }),
];

/** 全対応表 */
export const ALL_MAPPINGS: SheetItemMapping[] = [...STANDARD_MAPPINGS, ...LOCK_MAPPINGS];

/** エクセルの表記ゆれを吸収する（全角スペース・全角ｍ・前後空白） */
export function normalizeSheetLabel(value: string): string {
    return value.replace(/[\s　]+/g, '').replace(/ｍ/g, 'm');
}

/** (エクセル品名, エクセルサイズ) の突き合わせキー */
export function sheetKey(excelCategory: string, excelSpec: string): string {
    return `${normalizeSheetLabel(excelCategory)}|${normalizeSheetLabel(excelSpec)}`;
}

const STANDARD_BY_KEY = new Map(STANDARD_MAPPINGS.map((m) => [sheetKey(m.excelCategory, m.excelSpec), m]));
const LOCK_BY_KEY = new Map(LOCK_MAPPINGS.map((m) => [sheetKey(m.excelCategory, m.excelSpec), m]));

/**
 * エクセルの 1 行が DB のどの品目かを引く。
 * 見つからない = 対応表に無い行（取り込み対象外）。
 */
export function lookupMapping(
    method: ScaffoldMethod,
    excelCategory: string,
    excelSpec: string,
): SheetItemMapping | undefined {
    const table = method === 'lock' ? LOCK_BY_KEY : STANDARD_BY_KEY;
    return table.get(sheetKey(excelCategory, excelSpec));
}

/** DB 品目の突き合わせキー */
export function dbItemKey(categoryName: string, itemName: string): string {
    return `${normalizeSheetLabel(categoryName)}|${normalizeSheetLabel(itemName)}`;
}

/**
 * 数量セルを「数量 + 但し書き」に分解する。
 *
 * エクセルの数量欄には数字以外が混ざっている:
 *   "2500"          → 2500              （ただの数）
 *   "1560/色無800"  → 1560  + 原文       （色無しの内訳が併記されている）
 *   "1900+上野"     → 1900  + 原文       （上野の分は別勘定）
 *   "1130　他上野多数" → 1130 + 原文
 *   "27/ロック10"   → 27    + 原文       （ロック用の内訳が併記されている）
 *   "3大かどちらか" → 3     + 原文
 *   "many" "◎新品150" "-" → null + 原文  （数として読めないので未カウント扱い）
 *
 * 先頭が数字ならその数を数量に採り、原文は必ず note に残す。
 * 数量 null と 0 は別物（null = 数えていない / 0 = 数えて 0 本だった）。
 */
export function parseSheetCellValue(raw: unknown): { quantity: number | null; note: string | null } {
    if (raw === null || raw === undefined) return { quantity: null, note: null };
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { quantity: Math.round(raw), note: null } : { quantity: null, note: null };
    }

    // 数式セル・リッチテキストは表示されている文字を取り出す
    let text: string;
    if (typeof raw === 'object') {
        const obj = raw as { result?: unknown; richText?: { text: string }[]; text?: string };
        if (typeof obj.result === 'number') return { quantity: Math.round(obj.result), note: null };
        if (obj.richText) text = obj.richText.map((t) => t.text).join('');
        else if (typeof obj.text === 'string') text = obj.text;
        else if (typeof obj.result === 'string') text = obj.result;
        else return { quantity: null, note: null };
    } else {
        text = String(raw);
    }

    const trimmed = text.trim();
    if (trimmed === '') return { quantity: null, note: null };

    const leading = /^(\d+)/.exec(trimmed);
    const isPlainNumber = /^\d+$/.test(trimmed);
    return {
        quantity: leading ? Number(leading[1]) : null,
        note: isPlainNumber ? null : trimmed,
    };
}
