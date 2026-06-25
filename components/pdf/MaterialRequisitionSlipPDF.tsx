import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { sanitizePdfText, fitCellFontSize } from '@/components/pdf/styles';
import {
    PDF_LAYOUT,
    SHEET_SIZES,
    type PdfLayoutColumn,
    type PdfLayoutGroup,
    type SheetEntry,
    type FreeFormEntry,
} from '@/lib/materials/catalog';

/**
 * 出庫伝票（材料表）PDF。目標帳票「材料表 (新）R4.11」準拠のきれいなグリッド。
 *
 * レイアウト方針:
 *   - 各列のテーブルは [名称][規格][車①][車②][車③]。
 *   - 複数サイズ品目（柱 3.6/2.7/…）: 名称セルをサイズ行ぶん縦結合（中央寄せ）、各行に規格＋数量。
 *   - 単独品目（安全バー・金網・皿 等＝catalog で groupLabel==''）: 名称＋規格を結合した
 *     全幅セルに名前を中央寄せ。
 *   - 横罫線を 3 列で揃えるため、罫線（borderBottom）は「全行」に均一に付け、グループ
 *     コンテナ側には付けない（各列とも同じ行数＝行が列をまたいで一致）。
 *   - 全行を固定高にし、長い名前はセル幅に収まるようフォント自動縮小して 1 行に収める。
 *   - 左・中・右の各セクション（列）は太枠で囲む。
 *   - 行高は A4 縦下部まで使うよう動的に決める（シート欄がある時はその分だけ詰める）。
 */

export interface MaterialRequisitionSlipPDFProps {
    foremanName: string;        // 施工班名
    writerName?: string;        // 記入者名（未指定なら施工班名）
    customerName: string;       // 得意先
    honorific?: string;         // 得意先敬称
    siteName: string;           // 現場名
    assemblyDate: string;       // 組立日
    demolitionDate: string;     // 解体日
    vehicles: [string, string, string];
    /** セル単位の表示文字取得（自由入力＝文字列。例「20本」「残」）。該当無しは ''。 */
    getQty: (categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2) => string;
    sheets?: SheetEntry[];
    freeForm?: FreeFormEntry[];
}

type Group = PdfLayoutGroup;
type Column = PdfLayoutColumn;
const [LAYOUT_COL1, LAYOUT_COL2, LAYOUT_COL3] = PDF_LAYOUT;

// --- グリッド寸法（pt）---
const NAME_W = 46;              // 名称列
const SPEC_W = 30;              // 規格列
const FULL_W = NAME_W + SPEC_W; // 単独品目／車両ラベルの全幅
const QTY_W = 40;               // 数量セルのフォント縮小用の概算幅（実体は flex 等幅）
const THICK = 1.5;              // セクション（列）太枠
const THIN = 0.5;               // セル内罫線

// 各列の行数（PDF_LAYOUT から算出）。3 列の最下段を揃えるため COL3 末尾に
// 「その他」見出し＋自由記入行を足して GRID_ROWS（左右の多い方）に合わせる。
const COL1_ROWS = LAYOUT_COL1.groups.reduce((n, g) => n + g.rows.length, 0);
const COL2_ROWS = LAYOUT_COL2.groups.reduce((n, g) => n + g.rows.length, 0);
const COL3_SPINE_ROWS = LAYOUT_COL3.groups.reduce((n, g) => n + g.rows.length, 0);
const GRID_ROWS = Math.max(COL1_ROWS, COL2_ROWS);
const FREE_ROWS_IN_PDF = Math.max(0, GRID_ROWS - COL3_SPINE_ROWS - 1); // -1 = 「その他」見出し行

// A4 縦のページ寸法（pt）。行高の動的算出に使う。
const PAGE_USABLE_H = 822;  // 841.89 - padding(10*2)
const HEADER_H = 62;        // 施工班名 + 得意先行 + 車両行 の概算高（やや保守的に）
const GRID_FRAME = 3;       // グリッド上下の太枠
const ROW_H_MAX = 16.0;     // これ以上は広げない（シート無しでA4を満たし1ページに収まる値）
const ROW_H_MIN = 12.5;     // これ以下には詰めない（可読性）

/** シート欄に描画される行（種類×サイズ）を抽出する。 */
function sheetRowsOf(sheets: SheetEntry[]): Array<{ type: string; size: string; qtys: [string, string, string] }> {
    const rows: Array<{ type: string; size: string; qtys: [string, string, string] }> = [];
    for (const s of sheets) {
        for (const size of SHEET_SIZES) {
            const t = s.sizes[size];
            if (t && (String(t[0] ?? '').trim() || String(t[1] ?? '').trim() || String(t[2] ?? '').trim())) {
                rows.push({ type: s.type, size, qtys: [t[0] || '', t[1] || '', t[2] || ''] });
            }
        }
    }
    return rows;
}

/** A4 縦下部まで使うよう行高を決める。シート欄がある時はその分だけ詰める。 */
function computeRowHeight(sheetRowCount: number): number {
    const sheetH = sheetRowCount > 0 ? 28 + sheetRowCount * 14 : 0; // 見出し+行+枠+余白（保守的）
    const avail = PAGE_USABLE_H - HEADER_H - GRID_FRAME - sheetH;
    return Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, avail / GRID_ROWS));
}

const styles = StyleSheet.create({
    page: { fontFamily: 'NotoSansJP', fontSize: 8, padding: 10, backgroundColor: '#ffffff' },

    // ヘッダー（施工班名 / 記入者）
    topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, fontSize: 9 },
    topLabel: { marginRight: 4 },
    topValue: { borderBottomWidth: 0.5, borderBottomColor: '#000', minWidth: 80, paddingHorizontal: 4 },

    // メタ情報行（得意先 / 現場名 / 組立日 解体日）— 太枠
    metaRow: { flexDirection: 'row', borderWidth: THICK, borderColor: '#000', marginBottom: 0 },
    metaCell: { flex: 1, flexDirection: 'row', borderRightWidth: THICK, borderRightColor: '#000', minHeight: 16 },
    metaCellLast: { flex: 1, flexDirection: 'row', minHeight: 16 },
    metaLabel: { width: 44, padding: 3, borderRightWidth: THIN, borderRightColor: '#000', textAlign: 'center', fontSize: 8 },
    metaValue: { flex: 1, padding: 3, fontSize: 8 },
    metaDateRow: { flex: 1, flexDirection: 'row' },
    metaDateLabel: { padding: 3, fontSize: 8, borderRightWidth: THIN, borderRightColor: '#000' },
    metaDateValue: { flex: 1, padding: 3, fontSize: 8, borderRightWidth: THIN, borderRightColor: '#000' },
    metaDateValueLast: { flex: 1, padding: 3, fontSize: 8 },

    // 車両行 — 太枠・ラベルは全幅（名称＋規格）・値セルは数量と同じ等幅3列
    vehicleRow: { flexDirection: 'row', borderLeftWidth: THICK, borderRightWidth: THICK, borderBottomWidth: THICK, borderColor: '#000' },
    vehicleColumn: { flex: 1, flexDirection: 'row', borderRightWidth: THICK, borderRightColor: '#000', height: 16 },
    vehicleColumnLast: { flex: 1, flexDirection: 'row', height: 16 },
    vehicleLabelCell: { width: FULL_W, borderRightWidth: THIN, borderRightColor: '#000', fontSize: 8, alignItems: 'center', justifyContent: 'center' },
    vehicleValueCell: { flex: 1, borderRightWidth: THIN, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center' },
    vehicleValueCellLast: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // メイングリッド（3列）— 各列を太枠で
    grid: { flexDirection: 'row', borderLeftWidth: THICK, borderRightWidth: THICK, borderBottomWidth: THICK, borderColor: '#000' },
    column: { flex: 1, flexDirection: 'column', borderRightWidth: THICK, borderRightColor: '#000' },
    columnLast: { flex: 1, flexDirection: 'column' },

    // グループコンテナ（罫線は持たせない＝列ごとの drift 防止）
    group: { flexDirection: 'row' },
    groupRows: { flex: 1, flexDirection: 'column' },
    singlesGroup: { flexDirection: 'column' },

    // 行（高さは動的に inline 指定）。罫線は全行均一に borderBottom。
    row: { flexDirection: 'row', borderBottomWidth: THIN, borderBottomColor: '#000', alignItems: 'stretch' },

    // セル
    nameLabelCell: { width: NAME_W, borderRightWidth: THIN, borderBottomWidth: THIN, borderColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
    specCell: { width: SPEC_W, borderRightWidth: THIN, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
    fullNameCell: { width: FULL_W, borderRightWidth: THIN, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
    qtyCellsContainer: { flex: 1, flexDirection: 'row' },
    qtyCell: { flex: 1, borderRightWidth: THIN, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center' },
    qtyCellLast: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // 「その他」見出し（COL3 末尾・全幅。高さは inline）
    otherHeader: { flexDirection: 'row', borderBottomWidth: THIN, borderBottomColor: '#000', alignItems: 'center', justifyContent: 'center' },

    cellText: { fontSize: 7.5, textAlign: 'center' },
    bold: { fontWeight: 'bold' },

    // シートセクション（選択分のみ）
    extraSection: { marginTop: 4, borderWidth: THICK, borderColor: '#000' },
    extraHeader: { padding: 2, borderBottomWidth: THIN, borderBottomColor: '#000', fontSize: 8, fontWeight: 'bold', textAlign: 'center' },
    sheetRow: { flexDirection: 'row', borderBottomWidth: THIN, borderBottomColor: '#000', minHeight: 12 },
    sheetTypeCell: { width: 110, padding: 2, borderRightWidth: THIN, borderRightColor: '#000', fontSize: 7 },
    sheetSizeCell: { width: 28, padding: 2, borderRightWidth: THIN, borderRightColor: '#000', textAlign: 'center', fontSize: 7 },
    sheetQtyCell: { flex: 1, padding: 2, borderRightWidth: THIN, borderRightColor: '#000', textAlign: 'center', fontSize: 8 },
    sheetQtyCellLast: { flex: 1, padding: 2, textAlign: 'center', fontSize: 8 },
});

/** セル幅に1行で収まるようフォント自動縮小して描画する（折り返し防止）。 */
function FitText({ text, width, base = 7.5, bold = false }: { text: string; width: number; base?: number; bold?: boolean }) {
    const s = sanitizePdfText(text ?? '');
    const size = s ? fitCellFontSize(s, Math.max(1, width - 2), base, 5) : base;
    const textStyles = bold ? [styles.cellText, styles.bold, { fontSize: size }] : [styles.cellText, { fontSize: size }];
    return <Text style={textStyles}>{s}</Text>;
}

function Header({ foremanName, writerName }: { foremanName: string; writerName: string }) {
    return (
        <View style={styles.topRow}>
            <View style={{ flexDirection: 'row' }}>
                <Text style={styles.topLabel}>施工班名</Text>
                <Text style={styles.topValue}>{sanitizePdfText(foremanName)}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
                <Text style={styles.topLabel}>記入者</Text>
                <Text style={styles.topValue}>{sanitizePdfText(writerName || foremanName)}</Text>
            </View>
        </View>
    );
}

function MetaBox({ customerName, honorific, siteName, assemblyDate, demolitionDate }: { customerName: string; honorific: string; siteName: string; assemblyDate: string; demolitionDate: string }) {
    const customerDisplay = customerName ? `${customerName}${honorific ? ` ${honorific}` : ''}` : '';
    return (
        <View style={styles.metaRow}>
            <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>得意先</Text>
                <Text style={styles.metaValue}>{sanitizePdfText(customerDisplay)}</Text>
            </View>
            <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>現場名</Text>
                <Text style={styles.metaValue}>{sanitizePdfText(siteName)}</Text>
            </View>
            <View style={styles.metaCellLast}>
                <View style={styles.metaDateRow}>
                    <Text style={styles.metaDateLabel}>組立日</Text>
                    <Text style={styles.metaDateValue}>{sanitizePdfText(assemblyDate)}</Text>
                    <Text style={styles.metaDateLabel}>解体日</Text>
                    <Text style={styles.metaDateValueLast}>{sanitizePdfText(demolitionDate)}</Text>
                </View>
            </View>
        </View>
    );
}

function VehicleRow({ vehicles }: { vehicles: [string, string, string] }) {
    return (
        <View style={styles.vehicleRow}>
            {[0, 1, 2].map((colIdx) => {
                const isLast = colIdx === 2;
                return (
                    <View key={colIdx} style={isLast ? styles.vehicleColumnLast : styles.vehicleColumn}>
                        <View style={styles.vehicleLabelCell}><Text>車両</Text></View>
                        <View style={styles.vehicleValueCell}><Text>{sanitizePdfText(vehicles[0])}</Text></View>
                        <View style={styles.vehicleValueCell}><Text>{sanitizePdfText(vehicles[1])}</Text></View>
                        <View style={styles.vehicleValueCellLast}><Text>{sanitizePdfText(vehicles[2])}</Text></View>
                    </View>
                );
            })}
        </View>
    );
}

/** 数量セル（車①②③）。固定高の行内で等幅・縦中央。 */
function QtyCells({ qtys }: { qtys: [string, string, string] }) {
    return (
        <View style={styles.qtyCellsContainer}>
            <View style={styles.qtyCell}><FitText text={qtys[0]} width={QTY_W} base={9} /></View>
            <View style={styles.qtyCell}><FitText text={qtys[1]} width={QTY_W} base={9} /></View>
            <View style={styles.qtyCellLast}><FitText text={qtys[2]} width={QTY_W} base={9} /></View>
        </View>
    );
}

function GroupBlock({ group, getQty, rowH }: { group: Group; getQty: MaterialRequisitionSlipPDFProps['getQty']; rowH: number }) {
    const rows = group.rows;
    const rowStyle = [styles.row, { height: rowH }];
    const qtysFor = (row: Group['rows'][number]): [string, string, string] => [
        getQty(row.categoryName, row.itemName, 0),
        getQty(row.categoryName, row.itemName, 1),
        getQty(row.categoryName, row.itemName, 2),
    ];

    // 単独品目（空ラベル）: 各行を全幅名称セルで
    if (group.label === '') {
        return (
            <View style={styles.singlesGroup}>
                {rows.map((row, idx) => (
                    <View key={idx} style={rowStyle}>
                        <View style={styles.fullNameCell}><FitText text={row.spec} width={FULL_W} /></View>
                        <QtyCells qtys={qtysFor(row)} />
                    </View>
                ))}
            </View>
        );
    }

    // 名称付きグループ（複数サイズ）: 名称を縦結合し各行に規格＋数量
    return (
        <View style={styles.group}>
            <View style={styles.nameLabelCell}><FitText text={group.label} width={NAME_W} /></View>
            <View style={styles.groupRows}>
                {rows.map((row, idx) => (
                    <View key={idx} style={rowStyle}>
                        <View style={styles.specCell}><FitText text={row.spec} width={SPEC_W} /></View>
                        <QtyCells qtys={qtysFor(row)} />
                    </View>
                ))}
            </View>
        </View>
    );
}

/** COL3 末尾「その他」自由記入。COL1/COL2 と最下段（行数）を揃える。 */
function FreeColumnRows({ freeForm, rowH }: { freeForm: FreeFormEntry[]; rowH: number }) {
    const filled = freeForm.filter((f) => f.label.trim() || f.qty[0]?.trim() || f.qty[1]?.trim() || f.qty[2]?.trim());
    const blanks = Math.max(0, FREE_ROWS_IN_PDF - filled.length);
    const rows: FreeFormEntry[] = [
        ...filled,
        ...Array.from({ length: blanks }, () => ({ label: '', qty: ['', '', ''] as [string, string, string] })),
    ];
    return (
        <View style={styles.singlesGroup}>
            <View style={[styles.otherHeader, { height: rowH }]}><FitText text="その他" width={FULL_W} bold /></View>
            {rows.map((row, idx) => (
                <View key={idx} style={[styles.row, { height: rowH }]}>
                    <View style={styles.fullNameCell}><FitText text={row.label} width={FULL_W} /></View>
                    <QtyCells qtys={[row.qty[0] || '', row.qty[1] || '', row.qty[2] || '']} />
                </View>
            ))}
        </View>
    );
}

function ColumnBlock({ column, getQty, isLast, rowH, freeForm }: { column: Column; getQty: MaterialRequisitionSlipPDFProps['getQty']; isLast: boolean; rowH: number; freeForm?: FreeFormEntry[] }) {
    return (
        <View style={isLast ? styles.columnLast : styles.column}>
            {column.groups.map((group, idx) => (
                <GroupBlock key={idx} group={group} getQty={getQty} rowH={rowH} />
            ))}
            {freeForm && <FreeColumnRows freeForm={freeForm} rowH={rowH} />}
        </View>
    );
}

/** シート（種類 × サイズ × 車両）セクション。選択された種類のみ描画。 */
function SheetSection({ sheets }: { sheets: SheetEntry[] }) {
    const rows = sheetRowsOf(sheets);
    if (rows.length === 0) return null;
    return (
        <View style={styles.extraSection}>
            <Text style={styles.extraHeader}>シート</Text>
            {rows.map((r, idx) => {
                const isLast = idx === rows.length - 1;
                return (
                    <View key={idx} style={isLast ? [styles.sheetRow, { borderBottomWidth: 0 }] : styles.sheetRow}>
                        <Text style={styles.sheetTypeCell}>{sanitizePdfText(r.type)}</Text>
                        <Text style={styles.sheetSizeCell}>{sanitizePdfText(r.size)}</Text>
                        <Text style={styles.sheetQtyCell}>{sanitizePdfText(r.qtys[0] || '')}</Text>
                        <Text style={styles.sheetQtyCell}>{sanitizePdfText(r.qtys[1] || '')}</Text>
                        <Text style={styles.sheetQtyCellLast}>{sanitizePdfText(r.qtys[2] || '')}</Text>
                    </View>
                );
            })}
        </View>
    );
}

function SlipPageContent({
    foremanName, writerName, customerName, honorific, siteName, assemblyDate, demolitionDate, vehicles, getQty, sheets, freeForm,
}: MaterialRequisitionSlipPDFProps) {
    const sheetList = sheets ?? [];
    const rowH = computeRowHeight(sheetRowsOf(sheetList).length);
    return (
        <>
            <Header foremanName={foremanName} writerName={writerName ?? ''} />
            <MetaBox customerName={customerName} honorific={honorific ?? ''} siteName={siteName} assemblyDate={assemblyDate} demolitionDate={demolitionDate} />
            <VehicleRow vehicles={vehicles} />
            <View style={styles.grid}>
                <ColumnBlock column={LAYOUT_COL1} getQty={getQty} isLast={false} rowH={rowH} />
                <ColumnBlock column={LAYOUT_COL2} getQty={getQty} isLast={false} rowH={rowH} />
                <ColumnBlock column={LAYOUT_COL3} getQty={getQty} isLast={true} rowH={rowH} freeForm={freeForm ?? []} />
            </View>
            <SheetSection sheets={sheetList} />
        </>
    );
}

/** 単一伝票 */
export function MaterialRequisitionSlipPDF(props: MaterialRequisitionSlipPDFProps) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <SlipPageContent {...props} />
            </Page>
        </Document>
    );
}

/** 複数伝票連結（一括印刷用） */
export function MaterialRequisitionSlipMultiPDF({ slips }: { slips: MaterialRequisitionSlipPDFProps[] }) {
    return (
        <Document>
            {slips.map((slip, idx) => (
                <Page key={idx} size="A4" style={styles.page}>
                    <SlipPageContent {...slip} />
                </Page>
            ))}
        </Document>
    );
}
