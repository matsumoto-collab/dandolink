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
 * 出庫伝票（材料表）PDF。目標帳票「材料表 (新）R4.11」に準拠したきれいなグリッド。
 *
 * 3 列固定レイアウトは lib/materials/catalog.ts の PDF_LAYOUT を単一の正として生成する。
 * 各セルは categoryName + itemName でマスタ品目に対応付け、getQty から数量を引く。
 *
 * レイアウト方針（R4.11 準拠）:
 *   - 各列のテーブルは [名称][規格][車①][車②][車③]。
 *   - 複数サイズ品目（柱 3.6/2.7/… 等）: 名称セルをサイズ行ぶん縦結合（左に1回・中央寄せ）、
 *     各行に規格（サイズ）＋車①②③の数量セル。
 *   - 単独品目（安全バー・金網・皿・ハッチ付きアンチ 等＝catalog で groupLabel==''）:
 *     名称＋規格を結合した「全幅セル」に名前を中央寄せ（空の名称セルを作らない）。
 *   - 全行を固定高にし、長い名前はセル幅に収まるようフォント自動縮小して 1 行に収める
 *     （折り返しによる行高バラつき・はみ出しを防止）。
 *
 * シート（SHEET_TYPES）/ 汎用自由欄は MaterialRequisition.notes の JSON 由来。
 */

export interface MaterialRequisitionSlipPDFProps {
    /** ヘッダー情報 */
    foremanName: string;        // 施工班名
    /** 記入者名（未指定なら施工班名を流用） */
    writerName?: string;
    customerName: string;       // 得意先
    /** 得意先の敬称（例: 様）。指定時は得意先名の後ろに付与 */
    honorific?: string;
    siteName: string;           // 現場名（工事名称 title を想定）
    assemblyDate: string;       // 組立日 (YYYY/MM/DD 等)
    demolitionDate: string;     // 解体日
    /** 車両3欄 (車両1,車両2,車両3) */
    vehicles: [string, string, string];
    /**
     * セル単位の表示文字取得関数（自由入力＝文字列。例「20本」「残」）。
     * 例: getQty('柱', '3.6m', 0) -> 車両0(=列1) の表示文字。該当無しは ''（空欄）。
     */
    getQty: (categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2) => string;
    /** シート（種類 × サイズ × 車両）。notes-JSON 由来。空配列なら非表示 */
    sheets?: SheetEntry[];
    /** 汎用自由欄。notes-JSON 由来 */
    freeForm?: FreeFormEntry[];
}

// catalog 由来の PDF レイアウト（単一の正）
type Group = PdfLayoutGroup;
type Column = PdfLayoutColumn;
const [LAYOUT_COL1, LAYOUT_COL2, LAYOUT_COL3] = PDF_LAYOUT;

// --- グリッド寸法（pt）。全行・全列で固定し体裁を揃える ---
const NAME_W = 46;   // 名称列
const SPEC_W = 30;   // 規格列
const FULL_W = NAME_W + SPEC_W; // 単独品目の全幅名称セル
const ROW_H = 13;    // 全材料行の固定高（A4縦・約47行/列が収まる値）
const QTY_W = 36;    // 数量セルのフォント縮小用の概算幅（実体は flex 等幅）

/**
 * COL3 末尾「その他」自由記入の空行数。
 * COL1/COL2（各約47行）と最下段を揃えるための行数。
 */
const FREE_ROWS_IN_PDF = 19;

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        padding: 10,
        backgroundColor: '#ffffff',
    },
    // ヘッダー（施工班名 / 記入者）
    topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, fontSize: 9 },
    topLabel: { marginRight: 4 },
    topValue: { borderBottomWidth: 0.5, borderBottomColor: '#000', minWidth: 80, paddingHorizontal: 4 },
    // メタ情報行（得意先 / 現場名 / 組立日 解体日）
    metaRow: { flexDirection: 'row', borderWidth: 0.5, borderColor: '#000', marginBottom: 0 },
    metaCell: { flex: 1, flexDirection: 'row', borderRightWidth: 0.5, borderRightColor: '#000', padding: 0, minHeight: 14 },
    metaCellLast: { flex: 1, flexDirection: 'row', padding: 0, minHeight: 14 },
    metaLabel: { width: 44, padding: 3, borderRightWidth: 0.5, borderRightColor: '#000', textAlign: 'center', fontSize: 8 },
    metaValue: { flex: 1, padding: 3, fontSize: 8 },
    metaDateRow: { flex: 1, flexDirection: 'row' },
    metaDateLabel: { padding: 3, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#000' },
    metaDateValue: { flex: 1, padding: 3, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#000' },
    metaDateValueLast: { flex: 1, padding: 3, fontSize: 8 },
    // 車両行
    vehicleRow: { flexDirection: 'row', borderLeftWidth: 0.5, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#000' },
    vehicleColumn: { flex: 1, flexDirection: 'row', borderRightWidth: 0.5, borderRightColor: '#000', minHeight: 14 },
    vehicleColumnLast: { flex: 1, flexDirection: 'row', minHeight: 14 },
    vehicleLabelCell: { width: NAME_W, padding: 2, borderRightWidth: 0.5, borderRightColor: '#000', textAlign: 'center', fontSize: 8, justifyContent: 'center' },
    vehicleValueCell: { flex: 1, padding: 2, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#000', textAlign: 'center' },
    vehicleValueCellLast: { flex: 1, padding: 2, fontSize: 8, textAlign: 'center' },

    // メイングリッド（3列）
    grid: { flexDirection: 'row', borderLeftWidth: 0.5, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: '#000' },
    column: { flex: 1, flexDirection: 'column', borderRightWidth: 0.5, borderRightColor: '#000' },
    columnLast: { flex: 1, flexDirection: 'column' },

    // 名称付きグループ（複数サイズ）: [名称(縦結合)] | [サイズ行...]
    group: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#000' },
    groupLast: { flexDirection: 'row' },
    nameLabelCell: {
        width: NAME_W,
        borderRightWidth: 0.5, borderRightColor: '#000',
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 1,
    },
    groupRows: { flex: 1, flexDirection: 'column' },

    // 単独品目グループ（groupLabel==''）: 各行が全幅名称セル
    singlesGroup: { flexDirection: 'column', borderBottomWidth: 0.5, borderBottomColor: '#000' },
    singlesGroupLast: { flexDirection: 'column' },

    // 行（固定高）
    row: { flexDirection: 'row', height: ROW_H, borderBottomWidth: 0.5, borderBottomColor: '#000', alignItems: 'stretch' },
    rowLast: { flexDirection: 'row', height: ROW_H, alignItems: 'stretch' },

    // セル
    specCell: { width: SPEC_W, borderRightWidth: 0.5, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
    fullNameCell: { width: FULL_W, borderRightWidth: 0.5, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
    qtyCellsContainer: { flex: 1, flexDirection: 'row' },
    qtyCell: { flex: 1, borderRightWidth: 0.5, borderRightColor: '#000', alignItems: 'center', justifyContent: 'center' },
    qtyCellLast: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // 「その他」見出し（COL3 末尾・全幅）
    otherHeader: { flexDirection: 'row', height: ROW_H, borderBottomWidth: 0.5, borderBottomColor: '#000', alignItems: 'center', justifyContent: 'center' },

    cellText: { fontSize: 7.5, textAlign: 'center' },
    bold: { fontWeight: 'bold' },

    // シートセクション（選択分のみ）
    extraSection: { marginTop: 4, borderWidth: 0.5, borderColor: '#000' },
    extraHeader: { padding: 2, borderBottomWidth: 0.5, borderBottomColor: '#000', fontSize: 8, fontWeight: 'bold', textAlign: 'center' },
    sheetRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#000', minHeight: 12 },
    sheetTypeCell: { width: 110, padding: 2, borderRightWidth: 0.5, borderRightColor: '#000', fontSize: 7 },
    sheetSizeCell: { width: 28, padding: 2, borderRightWidth: 0.5, borderRightColor: '#000', textAlign: 'center', fontSize: 7 },
    sheetQtyCell: { flex: 1, padding: 2, borderRightWidth: 0.5, borderRightColor: '#000', textAlign: 'center', fontSize: 8 },
    sheetQtyCellLast: { flex: 1, padding: 2, textAlign: 'center', fontSize: 8 },
});

/** セル幅に1行で収まるようフォント自動縮小して描画する（折り返し防止）。 */
function FitText({ text, width, base = 7.5, bold = false }: { text: string; width: number; base?: number; bold?: boolean }) {
    const s = sanitizePdfText(text ?? '');
    const size = s ? fitCellFontSize(s, Math.max(1, width - 2), base, 5) : base;
    const textStyles = bold
        ? [styles.cellText, styles.bold, { fontSize: size }]
        : [styles.cellText, { fontSize: size }];
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
                        <Text style={styles.vehicleLabelCell}>車両</Text>
                        <Text style={styles.vehicleValueCell}>{sanitizePdfText(vehicles[0])}</Text>
                        <Text style={styles.vehicleValueCell}>{sanitizePdfText(vehicles[1])}</Text>
                        <Text style={styles.vehicleValueCellLast}>{sanitizePdfText(vehicles[2])}</Text>
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

function GroupBlock({ group, getQty, isLastGroup }: { group: Group; getQty: MaterialRequisitionSlipPDFProps['getQty']; isLastGroup: boolean }) {
    const rows = group.rows;
    const qtysFor = (row: Group['rows'][number]): [string, string, string] => [
        getQty(row.categoryName, row.itemName, 0),
        getQty(row.categoryName, row.itemName, 1),
        getQty(row.categoryName, row.itemName, 2),
    ];

    // 単独品目（空ラベル）: 各行を全幅名称セルで描画
    if (group.label === '') {
        return (
            <View style={isLastGroup ? styles.singlesGroupLast : styles.singlesGroup}>
                {rows.map((row, idx) => {
                    const last = idx === rows.length - 1;
                    return (
                        <View key={idx} style={last ? styles.rowLast : styles.row}>
                            <View style={styles.fullNameCell}><FitText text={row.spec} width={FULL_W} /></View>
                            <QtyCells qtys={qtysFor(row)} />
                        </View>
                    );
                })}
            </View>
        );
    }

    // 名称付きグループ（複数サイズ）: 名称を縦結合し、各行に規格＋数量
    return (
        <View style={isLastGroup ? styles.groupLast : styles.group}>
            <View style={styles.nameLabelCell}><FitText text={group.label} width={NAME_W} /></View>
            <View style={styles.groupRows}>
                {rows.map((row, idx) => {
                    const last = idx === rows.length - 1;
                    return (
                        <View key={idx} style={last ? styles.rowLast : styles.row}>
                            <View style={styles.specCell}><FitText text={row.spec} width={SPEC_W} /></View>
                            <QtyCells qtys={qtysFor(row)} />
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

/**
 * COL3 末尾「その他」自由記入。見出し行のあと、入力済み自由欄＋空行を全幅で並べ、
 * COL1/COL2 と最下段を揃える。各行は単独品目と同じ全幅名称セル＋数量。
 */
function FreeColumnRows({ freeForm }: { freeForm: FreeFormEntry[] }) {
    const filled = freeForm.filter((f) => f.label.trim() || f.qty[0]?.trim() || f.qty[1]?.trim() || f.qty[2]?.trim());
    const blanks = Math.max(0, FREE_ROWS_IN_PDF - filled.length);
    const rows: FreeFormEntry[] = [
        ...filled,
        ...Array.from({ length: blanks }, () => ({ label: '', qty: ['', '', ''] as [string, string, string] })),
    ];
    return (
        <View style={styles.singlesGroupLast}>
            <View style={styles.otherHeader}>
                <FitText text="その他" width={FULL_W} bold />
            </View>
            {rows.map((row, idx) => {
                const last = idx === rows.length - 1;
                return (
                    <View key={idx} style={last ? styles.rowLast : styles.row}>
                        <View style={styles.fullNameCell}><FitText text={row.label} width={FULL_W} /></View>
                        <QtyCells qtys={[row.qty[0] || '', row.qty[1] || '', row.qty[2] || '']} />
                    </View>
                );
            })}
        </View>
    );
}

function ColumnBlock({ column, getQty, isLast, freeForm }: { column: Column; getQty: MaterialRequisitionSlipPDFProps['getQty']; isLast: boolean; freeForm?: FreeFormEntry[] }) {
    const hasFree = !!freeForm;
    return (
        <View style={isLast ? styles.columnLast : styles.column}>
            {column.groups.map((group, idx) => (
                <GroupBlock
                    key={idx}
                    group={group}
                    getQty={getQty}
                    isLastGroup={!hasFree && idx === column.groups.length - 1}
                />
            ))}
            {/* COL3 末尾：その他 自由記入で 3 列の最下段を揃える */}
            {hasFree && <FreeColumnRows freeForm={freeForm!} />}
        </View>
    );
}

/** シート（種類 × サイズ × 車両）セクション。選択された種類のみ描画（1 ページ収め維持） */
function SheetSection({ sheets }: { sheets: SheetEntry[] }) {
    const rows: Array<{ type: string; size: string; qtys: [string, string, string] }> = [];
    for (const s of sheets) {
        for (const size of SHEET_SIZES) {
            const t = s.sizes[size];
            if (t && (String(t[0] ?? '').trim() || String(t[1] ?? '').trim() || String(t[2] ?? '').trim())) {
                rows.push({ type: s.type, size, qtys: [t[0] || '', t[1] || '', t[2] || ''] });
            }
        }
    }
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

/** 1ページ分の中身を描画 */
function SlipPageContent({
    foremanName, writerName, customerName, honorific, siteName, assemblyDate, demolitionDate, vehicles, getQty, sheets, freeForm,
}: MaterialRequisitionSlipPDFProps) {
    return (
        <>
            <Header foremanName={foremanName} writerName={writerName ?? ''} />
            <MetaBox customerName={customerName} honorific={honorific ?? ''} siteName={siteName} assemblyDate={assemblyDate} demolitionDate={demolitionDate} />
            <VehicleRow vehicles={vehicles} />

            <View style={styles.grid}>
                <ColumnBlock column={LAYOUT_COL1} getQty={getQty} isLast={false} />
                <ColumnBlock column={LAYOUT_COL2} getQty={getQty} isLast={false} />
                <ColumnBlock column={LAYOUT_COL3} getQty={getQty} isLast={true} freeForm={freeForm ?? []} />
            </View>

            <SheetSection sheets={sheets ?? []} />
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
