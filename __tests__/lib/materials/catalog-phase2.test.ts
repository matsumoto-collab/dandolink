/**
 * 材料カタログ Phase 2 不変条件
 *
 * PDF / 入力フォーム / 印刷経路を catalog 駆動生成に切替えたことによる
 * 主要不変条件を検証する:
 *   - PDF_LAYOUT の列/グループ件数が CATALOG_ITEMS と一致
 *   - PDF_LAYOUT の行順 (spec/categoryName/itemName) が catalog の宣言順と一致
 *   - フォーム生成（catalog 全品目網羅 / 自然キー一意）
 *   - シート notes-JSON のラウンドトリップ（parse ⇔ serialize）
 *   - 旧プレーン notes の memo フォールバック
 */
import {
    CATALOG_ITEMS,
    PDF_LAYOUT,
    buildPdfLayout,
    countByColumn,
    SHEET_TYPES,
    SHEET_SIZES,
    emptyRequisitionNotes,
    parseRequisitionNotes,
    serializeRequisitionNotes,
    type RequisitionNotes,
    type PdfColumn,
} from '@/lib/materials/catalog';

describe('catalog Phase 2: PDF_LAYOUT 生成', () => {
    it('PDF_LAYOUT は COL1/COL2/COL3 の 3 列', () => {
        expect(PDF_LAYOUT.map((c) => c.column)).toEqual(['COL1', 'COL2', 'COL3']);
    });

    it('列ごとの行総数が countByColumn と一致', () => {
        const counts = countByColumn();
        for (const col of PDF_LAYOUT) {
            const rowCount = col.groups.reduce((s, g) => s + g.rows.length, 0);
            expect(rowCount).toBe(counts[col.column]);
        }
    });

    it('PDF_LAYOUT 行総数が CATALOG_ITEMS 総数と一致（全品目網羅 / 欠落・重複なし）', () => {
        const total = PDF_LAYOUT.reduce(
            (s, c) => s + c.groups.reduce((g, grp) => g + grp.rows.length, 0),
            0,
        );
        expect(total).toBe(CATALOG_ITEMS.length);
    });

    it('各列の groups は groupIndex 昇順、行は orderInGroup 昇順で catalog と一致', () => {
        for (const col of PDF_LAYOUT) {
            const colItems = CATALOG_ITEMS.filter((it) => it.pdf.column === col.column);
            // 期待: (groupIndex, orderInGroup) でソートした (spec, cat, name) 列
            const expected = colItems
                .slice()
                .sort((a, b) =>
                    a.pdf.groupIndex !== b.pdf.groupIndex
                        ? a.pdf.groupIndex - b.pdf.groupIndex
                        : a.pdf.orderInGroup - b.pdf.orderInGroup,
                )
                .map((it) => `${it.specLabel}|${it.categoryName}|${it.itemName}`);
            const actual = col.groups.flatMap((g) =>
                g.rows.map((r) => `${r.spec}|${r.categoryName}|${r.itemName}`),
            );
            expect(actual).toEqual(expected);
        }
    });

    it('グループラベルは catalog の groupLabel と一致（ラベル無しグループも別ブロック保持）', () => {
        for (const col of PDF_LAYOUT) {
            const byGroup = new Map<number, string>();
            for (const it of CATALOG_ITEMS) {
                if (it.pdf.column === col.column) {
                    byGroup.set(it.pdf.groupIndex, it.pdf.groupLabel);
                }
            }
            const expectedLabels = Array.from(byGroup.keys())
                .sort((a, b) => a - b)
                .map((k) => byGroup.get(k)!);
            expect(col.groups.map((g) => g.label)).toEqual(expectedLabels);
        }
    });

    it('buildPdfLayout は CATALOG_ITEMS 既定で PDF_LAYOUT と同一', () => {
        expect(JSON.stringify(buildPdfLayout())).toBe(JSON.stringify(PDF_LAYOUT));
    });

    it('最長列の行数が 1 ページ収め予算（<=52行）以内（582b291 の約127pt余裕を維持）', () => {
        // 582b291: レイアウト約695pt / 使用可能約810pt → 約127pt 余裕。
        // グリッド行は minHeight 12pt。余裕 127pt ≒ 約10行ぶん。
        // 旧最長列 49 行 + 余裕 ≒ 52 行を 1 ページ収めの上限予算とする。
        // これを超えたら catalog 追加で 2 ページ化する恐れ → 要レイアウト見直し。
        const counts = countByColumn();
        const tallest = Math.max(counts.COL1, counts.COL2, counts.COL3);
        expect(tallest).toBeLessThanOrEqual(52);
    });

    it('PDF_LAYOUT の (categoryName,itemName) が catalog 自然キーに必ず存在（フォーム生成と整合）', () => {
        const keys = new Set(CATALOG_ITEMS.map((it) => `${it.categoryName}|${it.itemName}`));
        for (const col of PDF_LAYOUT) {
            for (const g of col.groups) {
                for (const r of g.rows) {
                    expect(keys.has(`${r.categoryName}|${r.itemName}`)).toBe(true);
                }
            }
        }
    });
});

describe('catalog Phase 2: シート / 自由欄 notes-JSON ラウンドトリップ', () => {
    it('SHEET_SIZES は 1.8/1.2/0.9/0.6 の 4 行', () => {
        expect(SHEET_SIZES).toEqual(['1.8', '1.2', '0.9', '0.6']);
    });

    it('空 notes は serialize で null（旧来の notes 無しと同じ扱い）', () => {
        expect(serializeRequisitionNotes(emptyRequisitionNotes())).toBeNull();
    });

    it('memo のみでも JSON で保存し v:1 として読み戻せる（プレーン誤認防止）', () => {
        const n: RequisitionNotes = { v: 1, memo: 'メモのみ', sheets: [], freeForm: [] };
        const s = serializeRequisitionNotes(n);
        expect(s).not.toBeNull();
        const back = parseRequisitionNotes(s);
        expect(back.memo).toBe('メモのみ');
        expect(back.sheets).toEqual([]);
        expect(back.freeForm).toEqual([]);
    });

    it('シート（種類×サイズ×車両）と自由欄をラウンドトリップ', () => {
        const n: RequisitionNotes = {
            v: 1,
            memo: '備考テキスト',
            sheets: [
                { type: SHEET_TYPES[0], sizes: { '1.8': [3, 0, 1], '0.6': [0, 2, 0] } },
                { type: '黒', sizes: { '0.9': [5, 5, 5] } },
            ],
            freeForm: [{ label: '特注品', qty: ['2', '', '1'] }],
        };
        const s = serializeRequisitionNotes(n);
        const back = parseRequisitionNotes(s);
        expect(back.memo).toBe('備考テキスト');
        expect(back.sheets).toHaveLength(2);
        expect(back.sheets[0].type).toBe(SHEET_TYPES[0]);
        expect(back.sheets[0].sizes['1.8']).toEqual([3, 0, 1]);
        expect(back.sheets[1].type).toBe('黒');
        expect(back.sheets[1].sizes['0.9']).toEqual([5, 5, 5]);
        expect(back.freeForm).toEqual([{ label: '特注品', qty: ['2', '', '1'] }]);
    });

    it('全 0 シート / 空自由欄は serialize で間引かれる', () => {
        const n: RequisitionNotes = {
            v: 1,
            memo: 'm',
            sheets: [{ type: SHEET_TYPES[0], sizes: { '1.8': [0, 0, 0] } }],
            freeForm: [{ label: '', qty: ['', '', ''] }],
        };
        const back = parseRequisitionNotes(serializeRequisitionNotes(n));
        expect(back.memo).toBe('m');
        expect(back.sheets).toEqual([]);
        expect(back.freeForm).toEqual([]);
    });

    it('旧プレーン notes は memo にフォールバック（後方互換）', () => {
        const back = parseRequisitionNotes('旧来の自由メモ文字列');
        expect(back.memo).toBe('旧来の自由メモ文字列');
        expect(back.sheets).toEqual([]);
        expect(back.freeForm).toEqual([]);
    });

    it('null / undefined は空 notes として扱う', () => {
        expect(parseRequisitionNotes(null)).toEqual(emptyRequisitionNotes());
        expect(parseRequisitionNotes(undefined)).toEqual(emptyRequisitionNotes());
    });

    it('未知の sheet type は除去される（破損データ耐性）', () => {
        const raw = JSON.stringify({
            v: 1,
            memo: '',
            sheets: [{ type: '存在しない種類', sizes: { '1.8': [1, 0, 0] } }],
            freeForm: [],
        });
        expect(parseRequisitionNotes(raw).sheets).toEqual([]);
    });

    it('PdfColumn 型の網羅（COL1/COL2/COL3 のみ）', () => {
        const cols: PdfColumn[] = ['COL1', 'COL2', 'COL3'];
        expect(new Set(CATALOG_ITEMS.map((it) => it.pdf.column))).toEqual(new Set(cols));
    });
});
