import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { sanitizePdfText } from '@/components/pdf/styles';
import {
    PDF_LAYOUT,
    SHEET_SIZES,
    type PdfLayoutColumn,
    type PdfLayoutGroup,
    type SheetEntry,
    type FreeFormEntry,
} from '@/lib/materials/catalog';

/**
 * 出庫伝票（材料表）PDF。
 *
 * 3 列固定レイアウトは lib/materials/catalog.ts の PDF_LAYOUT を単一の正として生成する。
 * （旧 COL1/COL2/COL3 ハードコードは廃止。catalog と PDF の二重定義を解消）
 * 各セルは categoryName + itemName でマスタ品目に対応付け、getQty から数量を引く。
 *
 * シート（SHEET_TYPES）/ 汎用自由欄は MaterialRequisition.notes の JSON 由来
 * （sheets / freeForm）を受け取り、選択された種類のみコンパクトに描画する
 * （直近コミット 582b291 の 1 ページ収めを維持するため、固定 3 行リース欄は廃止し
 *   選択分のみレンダリング）。
 */

export interface MaterialRequisitionSlipPDFProps {
    /** ヘッダー情報 */
    foremanName: string;        // 施工班名 / 記入者
    customerName: string;       // 得意先
    siteName: string;           // 現場名
    assemblyDate: string;       // 組立日 (YYYY/MM/DD 等)
    demolitionDate: string;     // 解体日
    /** 車両3欄 (車両1,車両2,車両3) */
    vehicles: [string, string, string];
    /**
     * セル単位の数量取得関数。
     * 例: getQty('柱', '3.6m', 0) -> 車両0(=列1) の数量
     * 該当無しは 0 / 空欄として扱う
     */
    getQty: (categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2) => number;
    /** シート（種類 × サイズ × 車両）。notes-JSON 由来。空配列なら非表示 */
    sheets?: SheetEntry[];
    /** 汎用自由欄。notes-JSON 由来。空配列なら最低 3 行の空欄を表示 */
    freeForm?: FreeFormEntry[];
}

// catalog 由来の PDF レイアウト（単一の正）
type Group = PdfLayoutGroup;
type Column = PdfLayoutColumn;
const [LAYOUT_COL1, LAYOUT_COL2, LAYOUT_COL3] = PDF_LAYOUT;

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        padding: 10,
        backgroundColor: '#ffffff',
    },
    // ヘッダー（施工班名 / 記入者）
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
        fontSize: 9,
    },
    topLabel: {
        marginRight: 4,
    },
    topValue: {
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minWidth: 80,
        paddingHorizontal: 4,
    },
    // メタ情報行（得意先 / 現場名 / 組立日 解体日）
    metaRow: {
        flexDirection: 'row',
        borderWidth: 0.5,
        borderColor: '#000',
        marginBottom: 0,
    },
    metaCell: {
        flex: 1,
        flexDirection: 'row',
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        padding: 0,
        minHeight: 14,
    },
    metaCellLast: {
        flex: 1,
        flexDirection: 'row',
        padding: 0,
        minHeight: 14,
    },
    metaLabel: {
        width: 44,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        textAlign: 'center',
        fontSize: 8,
    },
    metaValue: {
        flex: 1,
        padding: 3,
        fontSize: 8,
    },
    metaDateRow: {
        flex: 1,
        flexDirection: 'row',
    },
    metaDateLabel: {
        padding: 3,
        fontSize: 8,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
    },
    metaDateValue: {
        flex: 1,
        padding: 3,
        fontSize: 8,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
    },
    metaDateValueLast: {
        flex: 1,
        padding: 3,
        fontSize: 8,
    },
    // 車両行
    vehicleRow: {
        flexDirection: 'row',
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#000',
    },
    vehicleColumn: {
        flex: 1,
        flexDirection: 'row',
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        minHeight: 14,
    },
    vehicleColumnLast: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 14,
    },
    vehicleLabelCell: {
        width: 38,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        textAlign: 'center',
        fontSize: 8,
    },
    vehicleValueCell: {
        flex: 1,
        padding: 2,
        fontSize: 8,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        textAlign: 'center',
    },
    vehicleValueCellLast: {
        flex: 1,
        padding: 2,
        fontSize: 8,
        textAlign: 'center',
    },
    // メイングリッド (3列)
    grid: {
        flexDirection: 'row',
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#000',
    },
    column: {
        flex: 1,
        flexDirection: 'column',
        borderRightWidth: 0.5,
        borderRightColor: '#000',
    },
    columnLast: {
        flex: 1,
        flexDirection: 'column',
    },
    // グループ (ラベル + 複数行)
    group: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
    },
    groupLabel: {
        width: 50,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 1,
        fontSize: 8,
    },
    groupRows: {
        flex: 1,
        flexDirection: 'column',
    },
    itemRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#999',
        minHeight: 12,
    },
    itemRowLast: {
        flexDirection: 'row',
        minHeight: 12,
    },
    specCell: {
        width: 50,
        padding: 1,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        textAlign: 'center',
        fontSize: 8,
    },
    qtyCellsContainer: {
        flex: 1,
        flexDirection: 'row',
    },
    qtyCell: {
        flex: 1,
        padding: 1,
        borderRightWidth: 0.5,
        borderRightColor: '#999',
        textAlign: 'center',
        fontSize: 9,
    },
    qtyCellLast: {
        flex: 1,
        padding: 1,
        textAlign: 'center',
        fontSize: 9,
    },
    // シート / 自由欄セクション（旧リース品セクション枠を流用しコンパクト化）
    extraSection: {
        marginTop: 4,
        borderWidth: 0.5,
        borderColor: '#000',
    },
    extraHeader: {
        padding: 2,
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        fontSize: 8,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    sheetRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#999',
        minHeight: 12,
    },
    sheetTypeCell: {
        width: 110,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        fontSize: 7,
    },
    sheetSizeCell: {
        width: 28,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#999',
        textAlign: 'center',
        fontSize: 7,
    },
    sheetQtyCell: {
        flex: 1,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#999',
        textAlign: 'center',
        fontSize: 8,
    },
    sheetQtyCellLast: {
        flex: 1,
        padding: 2,
        textAlign: 'center',
        fontSize: 8,
    },
    freeRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#999',
        minHeight: 13,
    },
    freeLabel: {
        flex: 2,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        fontSize: 8,
    },
    freeQty: {
        flex: 1,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#999',
        textAlign: 'center',
        fontSize: 8,
    },
    freeQtyLast: {
        flex: 1,
        padding: 2,
        textAlign: 'center',
        fontSize: 8,
    },
});

function Header({ foremanName }: { foremanName: string }) {
    return (
        <View style={styles.topRow}>
            <View style={{ flexDirection: 'row' }}>
                <Text style={styles.topLabel}>施工班名</Text>
                <Text style={styles.topValue}>{sanitizePdfText(foremanName)}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
                <Text style={styles.topLabel}>記入者</Text>
                <Text style={styles.topValue}>{sanitizePdfText(foremanName)}</Text>
            </View>
        </View>
    );
}

function MetaBox({ customerName, siteName, assemblyDate, demolitionDate }: { customerName: string; siteName: string; assemblyDate: string; demolitionDate: string }) {
    return (
        <View style={styles.metaRow}>
            <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>得意先</Text>
                <Text style={styles.metaValue}>{sanitizePdfText(customerName)}</Text>
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

function QtyCells({ qtys }: { qtys: [number, number, number] }) {
    return (
        <View style={styles.qtyCellsContainer}>
            <Text style={styles.qtyCell}>{qtys[0] > 0 ? String(qtys[0]) : ''}</Text>
            <Text style={styles.qtyCell}>{qtys[1] > 0 ? String(qtys[1]) : ''}</Text>
            <Text style={styles.qtyCellLast}>{qtys[2] > 0 ? String(qtys[2]) : ''}</Text>
        </View>
    );
}

function GroupBlock({ group, getQty, isLastGroup }: { group: Group; getQty: MaterialRequisitionSlipPDFProps['getQty']; isLastGroup: boolean }) {
    return (
        <View style={[styles.group, isLastGroup ? { borderBottomWidth: 0 } : {}]}>
            <View style={styles.groupLabel}>
                <Text>{sanitizePdfText(group.label)}</Text>
            </View>
            <View style={styles.groupRows}>
                {group.rows.map((row, idx) => {
                    const isLast = idx === group.rows.length - 1;
                    const qtys: [number, number, number] = [
                        getQty(row.categoryName, row.itemName, 0),
                        getQty(row.categoryName, row.itemName, 1),
                        getQty(row.categoryName, row.itemName, 2),
                    ];
                    return (
                        <View key={idx} style={isLast ? styles.itemRowLast : styles.itemRow}>
                            <Text style={styles.specCell}>{sanitizePdfText(row.spec)}</Text>
                            <QtyCells qtys={qtys} />
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

function ColumnBlock({ column, getQty, isLast }: { column: Column; getQty: MaterialRequisitionSlipPDFProps['getQty']; isLast: boolean }) {
    return (
        <View style={isLast ? styles.columnLast : styles.column}>
            {column.groups.map((group, idx) => (
                <GroupBlock key={idx} group={group} getQty={getQty} isLastGroup={idx === column.groups.length - 1} />
            ))}
        </View>
    );
}

/** シート（種類 × サイズ × 車両）セクション。選択された種類のみ描画（1 ページ収め維持） */
function SheetSection({ sheets }: { sheets: SheetEntry[] }) {
    // 何かしら数量のある (type,size) のみ行にする
    const rows: Array<{ type: string; size: string; qtys: [number, number, number] }> = [];
    for (const s of sheets) {
        for (const size of SHEET_SIZES) {
            const t = s.sizes[size];
            if (t && (t[0] > 0 || t[1] > 0 || t[2] > 0)) {
                rows.push({ type: s.type, size, qtys: [t[0] || 0, t[1] || 0, t[2] || 0] });
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
                        <Text style={styles.sheetQtyCell}>{r.qtys[0] > 0 ? String(r.qtys[0]) : ''}</Text>
                        <Text style={styles.sheetQtyCell}>{r.qtys[1] > 0 ? String(r.qtys[1]) : ''}</Text>
                        <Text style={styles.sheetQtyCellLast}>{r.qtys[2] > 0 ? String(r.qtys[2]) : ''}</Text>
                    </View>
                );
            })}
        </View>
    );
}

/** 汎用「その他自由欄」セクション。空でも最低 3 行の空欄（記入用） */
function FreeFormSection({ freeForm }: { freeForm: FreeFormEntry[] }) {
    const filled = freeForm.filter(
        (f) => f.label.trim() || f.qty[0]?.trim() || f.qty[1]?.trim() || f.qty[2]?.trim(),
    );
    const blanks = Math.max(0, 3 - filled.length);
    const rows: FreeFormEntry[] = [
        ...filled,
        ...Array.from({ length: blanks }, () => ({ label: '', qty: ['', '', ''] as [string, string, string] })),
    ];
    return (
        <View style={styles.extraSection}>
            <Text style={styles.extraHeader}>その他自由欄</Text>
            {rows.map((row, idx) => {
                const isLast = idx === rows.length - 1;
                return (
                    <View key={idx} style={isLast ? [styles.freeRow, { borderBottomWidth: 0 }] : styles.freeRow}>
                        <Text style={styles.freeLabel}>{sanitizePdfText(row.label)}</Text>
                        <Text style={styles.freeQty}>{sanitizePdfText(row.qty[0] || '')}</Text>
                        <Text style={styles.freeQty}>{sanitizePdfText(row.qty[1] || '')}</Text>
                        <Text style={styles.freeQtyLast}>{sanitizePdfText(row.qty[2] || '')}</Text>
                    </View>
                );
            })}
        </View>
    );
}

/** 1ページ分の中身を描画 */
function SlipPageContent({
    foremanName, customerName, siteName, assemblyDate, demolitionDate, vehicles, getQty, sheets, freeForm,
}: MaterialRequisitionSlipPDFProps) {
    return (
        <>
            <Header foremanName={foremanName} />
            <MetaBox customerName={customerName} siteName={siteName} assemblyDate={assemblyDate} demolitionDate={demolitionDate} />
            <VehicleRow vehicles={vehicles} />

            <View style={styles.grid}>
                <ColumnBlock column={LAYOUT_COL1} getQty={getQty} isLast={false} />
                <ColumnBlock column={LAYOUT_COL2} getQty={getQty} isLast={false} />
                <ColumnBlock column={LAYOUT_COL3} getQty={getQty} isLast={true} />
            </View>

            <SheetSection sheets={sheets ?? []} />
            <FreeFormSection freeForm={freeForm ?? []} />
        </>
    );
}

/** 単一伝票 (ライブプレビュー用) */
export function MaterialRequisitionSlipPDF(props: MaterialRequisitionSlipPDFProps) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <SlipPageContent {...props} />
            </Page>
        </Document>
    );
}

/** 複数伝票連結 (一括印刷用) */
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
