/**
 * 材料管理表エクセルの読み取り（対応表とセル値の解析）。
 *
 * エクセルの数量欄には数字以外が混ざっている。ここを間違えると
 * 過去 23 回分の棚卸が丸ごと化けるので、実際に入っている値の形を固定しておく。
 */
import {
    ALL_MAPPINGS,
    LOCK_MAPPINGS,
    SHEET_SOURCES,
    STANDARD_MAPPINGS,
    dbItemKey,
    lookupMapping,
    normalizeSheetLabel,
    parseSheetCellValue,
    sheetKey,
} from '@/lib/materials/stocktakeSheetMap';

describe('parseSheetCellValue', () => {
    it('ただの数はそのまま数量になり、但し書きは付かない', () => {
        expect(parseSheetCellValue(2500)).toEqual({ quantity: 2500, note: null });
        expect(parseSheetCellValue('3895')).toEqual({ quantity: 3895, note: null });
    });

    it('0 は「数えて 0 本」として扱う（未カウントの null とは別物）', () => {
        expect(parseSheetCellValue(0)).toEqual({ quantity: 0, note: null });
        expect(parseSheetCellValue('0')).toEqual({ quantity: 0, note: null });
    });

    it('空欄は未カウント（数量も但し書きも無し）', () => {
        expect(parseSheetCellValue(null)).toEqual({ quantity: null, note: null });
        expect(parseSheetCellValue(undefined)).toEqual({ quantity: null, note: null });
        expect(parseSheetCellValue('   ')).toEqual({ quantity: null, note: null });
    });

    it('数字で始まる但し書き付きは、先頭の数を数量にして原文を残す', () => {
        // 実際にエクセルに入っている値
        expect(parseSheetCellValue('1560/色無800')).toEqual({ quantity: 1560, note: '1560/色無800' });
        expect(parseSheetCellValue('1900+上野')).toEqual({ quantity: 1900, note: '1900+上野' });
        expect(parseSheetCellValue('1130　他上野多数')).toEqual({ quantity: 1130, note: '1130　他上野多数' });
        expect(parseSheetCellValue('27/ロック10')).toEqual({ quantity: 27, note: '27/ロック10' });
        expect(parseSheetCellValue('3大かどちらか')).toEqual({ quantity: 3, note: '3大かどちらか' });
        expect(parseSheetCellValue('920+上野1000')).toEqual({ quantity: 920, note: '920+上野1000' });
    });

    it('数として読めない値は未カウントにして原文だけ残す', () => {
        expect(parseSheetCellValue('many')).toEqual({ quantity: null, note: 'many' });
        expect(parseSheetCellValue('-')).toEqual({ quantity: null, note: '-' });
        expect(parseSheetCellValue('◎')).toEqual({ quantity: null, note: '◎' });
        expect(parseSheetCellValue('◎新品150')).toEqual({ quantity: null, note: '◎新品150' });
        expect(parseSheetCellValue('ロック1000')).toEqual({ quantity: null, note: 'ロック1000' });
    });

    it('数式セル・リッチテキストは表示されている値を読む', () => {
        expect(parseSheetCellValue({ result: 120, formula: 'SUM(A1:A3)' })).toEqual({ quantity: 120, note: null });
        expect(parseSheetCellValue({ richText: [{ text: '450' }, { text: '/色無50' }] })).toEqual({
            quantity: 450,
            note: '450/色無50',
        });
    });
});

describe('normalizeSheetLabel', () => {
    it('全角スペース・半角スペース・全角ｍ の揺れを吸収する', () => {
        // エクセルの A 列は「　ブラケット　」のように全角スペースで囲まれている
        expect(normalizeSheetLabel('　ブラケット　')).toBe('ブラケット');
        expect(normalizeSheetLabel('6ｍ')).toBe('6m');
        expect(normalizeSheetLabel(' 1.8 ')).toBe('1.8');
    });

    it('突き合わせキーが表記ゆれに影響されない', () => {
        expect(sheetKey('　ブラケット　', '0.6')).toBe(sheetKey('ブラケット', '0.6'));
        expect(dbItemKey('単管', '6ｍ')).toBe(dbItemKey('単管', '6m'));
    });
});

describe('lookupMapping', () => {
    it('エクセルの「大 / 小 / 200」を DB の 0.6 / 0.4 / 0.2 に読み替える', () => {
        // 2026-07-28 の数量（137 / 130 / 180）が DB と一致することで確認済みの対応
        expect(lookupMapping('standard', 'ピン付き', '大')).toMatchObject({ category: 'ピン付き', item: '0.6m' });
        expect(lookupMapping('standard', 'ピン付き', '小')).toMatchObject({ category: 'ピン付き', item: '0.4m' });
        expect(lookupMapping('standard', 'ピン付き', '200')).toMatchObject({ category: 'ピン付き', item: '0.2m' });
    });

    it('メッシュシートの色を DB のシート品目名に読み替える', () => {
        expect(lookupMapping('standard', 'メッシュシート(グレー)', '1.8')).toMatchObject({
            category: 'シート',
            item: '新築用 グレー(紐付) 1.8',
        });
        expect(lookupMapping('standard', 'メッシュシート(黒)', '0.6')).toMatchObject({
            category: 'シート',
            item: '黒 0.6',
        });
    });

    it('A 列の全角スペースが入っていても引ける', () => {
        expect(lookupMapping('standard', '　ブラケット　', '0.6')).toMatchObject({
            category: 'ブラケット',
            item: '0.6m',
        });
    });

    it('工法が違えば別の品目を指す（階段手摺は通常足場とロックで別物）', () => {
        expect(lookupMapping('standard', '階段手摺', '階段手摺')).toMatchObject({ category: '階段手摺' });
        expect(lookupMapping('lock', '階段手摺', '階段手摺')).toMatchObject({ category: 'ロック階段手摺' });
    });

    it('通常足場の表からロック足場の品目は引けない', () => {
        expect(lookupMapping('standard', 'ロック手摺', '1.8')).toBeUndefined();
        expect(lookupMapping('lock', 'ロック手摺', '1.8')).toMatchObject({ category: 'ロック手摺', item: '1.8m' });
    });

    it('対応表に無い行は undefined（壁繋ぎはサイズが分からないので対象外）', () => {
        expect(lookupMapping('standard', '壁繋ぎ', '壁繋ぎ')).toBeUndefined();
    });
});

describe('対応表そのものの健全性', () => {
    it('同じ (工法, エクセル品名, サイズ) が二重に定義されていない', () => {
        for (const table of [STANDARD_MAPPINGS, LOCK_MAPPINGS]) {
            const keys = table.map((m) => sheetKey(m.excelCategory, m.excelSpec));
            expect(new Set(keys).size).toBe(keys.length);
        }
    });

    it('同じ DB 品目を 2 つのエクセル行が指していない', () => {
        const keys = ALL_MAPPINGS.map((m) => dbItemKey(m.category, m.item));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('ロック側の対応はすべて method=lock になっている', () => {
        expect(LOCK_MAPPINGS.every((m) => m.method === 'lock')).toBe(true);
        expect(STANDARD_MAPPINGS.every((m) => m.method === 'standard')).toBe(true);
    });

    it('シートは 置き場所 × 工法 に割り当てられている（ロックは工法なので置き場所は土場）', () => {
        expect(SHEET_SOURCES.map((s) => [s.sheet, s.locationName, s.method])).toEqual([
            ['土場', '土場', 'standard'],
            ['ロック', '土場', 'lock'],
            ['上野', '上野', 'standard'],
        ]);
    });

    it('ロックシート J 列の日付の打ち間違い（2024-10-30）を 2023-10-30 に直す', () => {
        // 土場シートの対応列が 2023-10-30 で、K 列(2024-02-14) より後の日付が
        // 左隣に来ていた＝年の打ち間違い。直さないと推移の並びが崩れる
        const lock = SHEET_SOURCES.find((s) => s.sheet === 'ロック');
        expect(lock?.dateOverrides).toEqual([
            expect.objectContaining({ column: 'J', wrongDate: '2024-10-30', date: '2023-10-30' }),
        ]);
    });

    it('過去データ用の品目（もう使っていない古い青）は archiveOnly になっている', () => {
        const oldBlue = ALL_MAPPINGS.filter((m) => m.excelCategory === 'メッシュシート(古い青)');
        expect(oldBlue.length).toBe(4);
        expect(oldBlue.every((m) => m.archiveOnly === true)).toBe(true);
    });
});
