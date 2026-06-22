import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { sanitizePdfText } from '@/components/pdf/styles';

/**
 * 出庫伝票（材料表）車両別版 PDF（B案）。
 *
 * 「全項目版」(MaterialRequisitionSlipPDF) が決まった位置に全品目を並べるのに対し、
 * こちらは各トラックに「積み込むものだけ」を一覧する。
 * 拾い出しリスト（formQuantities）＋シート（notes-JSON）＋自由欄を
 * 車両ごとに集計したものを呼び出し側で組み立てて渡す。
 *
 * 帳票レイアウト（列再編 §5）はこの版には影響しない（積込一覧は品目/規格/数量の3列固定）。
 */

/** 積込リストの 1 行 */
export interface LoadingListItem {
    /** 品目（カテゴリ名 / シート種類 / 自由欄ラベル） */
    name: string;
    /** 規格（サイズ等。無ければ空） */
    spec: string;
    /** 表示用数量（自由欄は「20ｍ」等の文字列もありうる） */
    qty: string;
}

/** 1 車両ぶんの積込リスト */
export interface LoadingListVehicle {
    /** 車両①/②/③ 等のラベル */
    label: string;
    /** 車両名（空欄可） */
    name: string;
    items: LoadingListItem[];
    /** 数量の数値合計（自由欄の非数値は 0 扱い） */
    subtotal: number;
}

export interface MaterialRequisitionLoadingPDFProps {
    foremanName: string;        // 施工班名
    writerName?: string;        // 記入者（未指定なら施工班名）
    customerName: string;       // 得意先
    honorific?: string;         // 敬称（例: 様）
    siteName: string;           // 現場名（工事名称）
    assemblyDate: string;       // 組立日
    demolitionDate: string;     // 解体日
    /** ヘッダー表示用の車両名 3 欄 */
    vehicleNames: [string, string, string];
    /** 積込のある車両のみ（items が空の車両は呼び出し側で除外して渡す） */
    vehicles: LoadingListVehicle[];
    /** 全車両の数量合計 */
    grandTotal: number;
}

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 9,
        padding: 16,
        backgroundColor: '#ffffff',
    },
    title: {
        fontSize: 13,
        fontWeight: 'bold',
        marginBottom: 6,
    },
    // ヘッダー（施工班名 / 記入者）
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
        fontSize: 9,
    },
    topLabel: { marginRight: 4 },
    topValue: {
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minWidth: 90,
        paddingHorizontal: 4,
    },
    // メタ枠（得意先 / 現場名 / 組立解体日 / 車両）
    metaBox: {
        borderWidth: 0.5,
        borderColor: '#000',
        marginBottom: 10,
    },
    metaRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
    },
    metaRowLast: { flexDirection: 'row' },
    metaCell: {
        flex: 1,
        flexDirection: 'row',
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        minHeight: 16,
    },
    metaCellLast: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 16,
    },
    metaLabel: {
        width: 46,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        textAlign: 'center',
        backgroundColor: '#f1f5f9',
        fontSize: 8,
    },
    metaValue: { flex: 1, padding: 3, fontSize: 8 },
    // 車両ブロック
    vehBlock: {
        borderWidth: 0.8,
        borderColor: '#000',
        marginBottom: 8,
    },
    vehHead: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#0f172a',
        color: '#ffffff',
        paddingVertical: 4,
        paddingHorizontal: 6,
        fontSize: 10,
        fontWeight: 'bold',
    },
    tHead: {
        flexDirection: 'row',
        backgroundColor: '#f1f5f9',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
    },
    tRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#cbd5e1',
        minHeight: 14,
    },
    tRowLast: { flexDirection: 'row', minHeight: 14 },
    cName: {
        flex: 2,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#cbd5e1',
        fontSize: 9,
    },
    cSpec: {
        flex: 1.4,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#cbd5e1',
        fontSize: 9,
    },
    cQty: {
        width: 52,
        padding: 3,
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: 9,
    },
    thName: { flex: 2, padding: 3, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#000' },
    thSpec: { flex: 1.4, padding: 3, fontSize: 8, borderRightWidth: 0.5, borderRightColor: '#000' },
    thQty: { width: 52, padding: 3, fontSize: 8, textAlign: 'center' },
    grand: {
        marginTop: 2,
        fontSize: 9,
        color: '#334155',
    },
    empty: {
        padding: 20,
        textAlign: 'center',
        color: '#64748b',
        fontSize: 10,
    },
});

function Header({ foremanName, writerName, customerName, honorific, siteName, assemblyDate, demolitionDate, vehicleNames }: Omit<MaterialRequisitionLoadingPDFProps, 'vehicles' | 'grandTotal'>) {
    const customerDisplay = customerName ? `${customerName}${honorific ? ` ${honorific}` : ''}` : '';
    return (
        <>
            <Text style={styles.title}>材料 積込リスト（車両別）</Text>
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
            <View style={styles.metaBox}>
                <View style={styles.metaRow}>
                    <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>得意先</Text>
                        <Text style={styles.metaValue}>{sanitizePdfText(customerDisplay)}</Text>
                    </View>
                    <View style={styles.metaCellLast}>
                        <Text style={styles.metaLabel}>現場名</Text>
                        <Text style={styles.metaValue}>{sanitizePdfText(siteName)}</Text>
                    </View>
                </View>
                <View style={styles.metaRow}>
                    <View style={styles.metaCell}>
                        <Text style={styles.metaLabel}>組立日</Text>
                        <Text style={styles.metaValue}>{sanitizePdfText(assemblyDate)}</Text>
                    </View>
                    <View style={styles.metaCellLast}>
                        <Text style={styles.metaLabel}>解体日</Text>
                        <Text style={styles.metaValue}>{sanitizePdfText(demolitionDate)}</Text>
                    </View>
                </View>
                <View style={styles.metaRowLast}>
                    {[0, 1, 2].map((vi) => (
                        <View key={vi} style={vi === 2 ? styles.metaCellLast : styles.metaCell}>
                            <Text style={styles.metaLabel}>{`車両${['①', '②', '③'][vi]}`}</Text>
                            <Text style={styles.metaValue}>{sanitizePdfText(vehicleNames[vi] || '')}</Text>
                        </View>
                    ))}
                </View>
            </View>
        </>
    );
}

function VehicleBlock({ vehicle }: { vehicle: LoadingListVehicle }) {
    return (
        <View style={styles.vehBlock} wrap={false}>
            <View style={styles.vehHead}>
                <Text>{sanitizePdfText(`${vehicle.label}　${vehicle.name || '(車両未設定)'}`)}</Text>
                <Text>{`${vehicle.items.length}品目 / 計${vehicle.subtotal}点`}</Text>
            </View>
            <View style={styles.tHead}>
                <Text style={styles.thName}>品目</Text>
                <Text style={styles.thSpec}>規格</Text>
                <Text style={styles.thQty}>数量</Text>
            </View>
            {vehicle.items.map((it, idx) => {
                const isLast = idx === vehicle.items.length - 1;
                return (
                    <View key={idx} style={isLast ? styles.tRowLast : styles.tRow}>
                        <Text style={styles.cName}>{sanitizePdfText(it.name)}</Text>
                        <Text style={styles.cSpec}>{sanitizePdfText(it.spec || '')}</Text>
                        <Text style={styles.cQty}>{sanitizePdfText(it.qty)}</Text>
                    </View>
                );
            })}
        </View>
    );
}

function LoadingPageContent(props: MaterialRequisitionLoadingPDFProps) {
    const { vehicles, grandTotal } = props;
    return (
        <>
            <Header
                foremanName={props.foremanName}
                writerName={props.writerName}
                customerName={props.customerName}
                honorific={props.honorific}
                siteName={props.siteName}
                assemblyDate={props.assemblyDate}
                demolitionDate={props.demolitionDate}
                vehicleNames={props.vehicleNames}
            />
            {vehicles.length === 0 ? (
                <Text style={styles.empty}>積み込む品目がありません</Text>
            ) : (
                <>
                    {vehicles.map((v, idx) => (
                        <VehicleBlock key={idx} vehicle={v} />
                    ))}
                    <Text style={styles.grand}>{`現場合計：${grandTotal}点（この拾い出しで積み込む総数）`}</Text>
                </>
            )}
        </>
    );
}

/** 車両別版（B案）単票 */
export function MaterialRequisitionLoadingPDF(props: MaterialRequisitionLoadingPDFProps) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <LoadingPageContent {...props} />
            </Page>
        </Document>
    );
}
