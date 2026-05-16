import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { sanitizePdfText } from '@/components/pdf/styles';

/**
 * 出庫伝票（材料表）PDF。画像のひな形どおりの3列固定レイアウト。
 * 各セルは categoryName + itemName でマスタ品目に対応付け、quantitiesByItemId / quantitiesByCellKey から数量を引く。
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
    /** 親綱の長さ表示 (例: "30m") */
    parentRopeMeter?: string;
    /** イメージシートの種類表示 */
    imageSheetText?: string;
    /**
     * セル単位の数量取得関数。
     * 例: getQty('柱', '3.6m', 0) -> 車両0(=列1) の数量
     * 該当無しは 0 / 空欄として扱う
     */
    getQty: (categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2) => number;
    /** リース品の自由記述行 (空配列なら空行のみ) */
    leasedItems?: Array<{ label: string; qty: string }>;
}

// 画像準拠の3列レイアウト定義
// (categoryName, itemName) は scripts/seed-materials.ts のシードと突き合わせ
// マスタに存在しない項目は数量が常に空欄になる
type Row = { spec: string; categoryName: string; itemName: string };
type Group = { label: string; rows: Row[] };
type Column = Group[];

const COL1: Column = [
    { label: '柱', rows: [
        { spec: '3.6', categoryName: '柱', itemName: '3.6m' },
        { spec: '2.7', categoryName: '柱', itemName: '2.7m' },
        { spec: '1.8', categoryName: '柱', itemName: '1.8m' },
        { spec: '0.9', categoryName: '柱', itemName: '0.9m' },
        { spec: '調整', categoryName: '柱', itemName: '調整' },
        { spec: '1コマ', categoryName: '柱', itemName: '1コマ' },
        { spec: '0.9切', categoryName: '柱', itemName: '0.9切' },
    ]},
    { label: '手摺', rows: [
        { spec: '1.8', categoryName: '手摺', itemName: '1.8m' },
        { spec: '1.2', categoryName: '手摺', itemName: '1.2m' },
        { spec: '0.9', categoryName: '手摺', itemName: '0.9m' },
        { spec: '0.6', categoryName: '手摺', itemName: '0.6m' },
        { spec: '0.4', categoryName: '手摺', itemName: '0.4m' },
        { spec: '0.3', categoryName: '手摺', itemName: '0.3m' },
        { spec: '0.2', categoryName: '手摺', itemName: '0.2m' },
        { spec: 'サイド', categoryName: '手摺', itemName: 'サイド' },
        { spec: 'イボ0.6', categoryName: '手摺', itemName: 'イボ0.6' },
    ]},
    { label: '400アンチ', rows: [
        { spec: '1.8', categoryName: '400アンチ', itemName: '1.8m' },
        { spec: '1.2', categoryName: '400アンチ', itemName: '1.2m' },
        { spec: '0.9', categoryName: '400アンチ', itemName: '0.9m' },
        { spec: '0.6', categoryName: '400アンチ', itemName: '0.6m' },
    ]},
    { label: '250ハーフ', rows: [
        { spec: '1.8', categoryName: '250ハーフ', itemName: '1.8m' },
        { spec: '1.2', categoryName: '250ハーフ', itemName: '1.2m' },
        { spec: '0.9', categoryName: '250ハーフ', itemName: '0.9m' },
        { spec: '0.6', categoryName: '250ハーフ', itemName: '0.6m' },
        { spec: '0.4', categoryName: '250ハーフ', itemName: '0.4m' },
    ]},
    { label: 'センターハーフ', rows: [
        { spec: '1.8', categoryName: 'センターハーフ', itemName: '1.8m' },
        { spec: '1.2', categoryName: 'センターハーフ', itemName: '1.2m' },
        { spec: '0.9', categoryName: 'センターハーフ', itemName: '0.9m' },
        { spec: '0.6', categoryName: 'センターハーフ', itemName: '0.6m' },
    ]},
    { label: '筋交', rows: [
        { spec: '1.8', categoryName: '筋交', itemName: '1.8m' },
        { spec: '1.2', categoryName: '筋交', itemName: '1.2m' },
        { spec: '0.9', categoryName: '筋交', itemName: '0.9m' },
    ]},
    { label: 'ブラケット', rows: [
        { spec: '0.6', categoryName: 'ブラケット', itemName: '0.6m' },
        { spec: '0.4', categoryName: 'ブラケット', itemName: '0.4m' },
    ]},
    { label: 'ピン付き', rows: [
        { spec: '0.8', categoryName: 'ピン付き', itemName: '0.8m' },
        { spec: '0.6', categoryName: 'ピン付き', itemName: '0.6m' },
        { spec: '0.4', categoryName: 'ピン付き', itemName: '0.4m' },
        { spec: '0.2', categoryName: 'ピン付き', itemName: '0.2m' },
    ]},
    { label: '階段', rows: [
        { spec: '鉄', categoryName: '階段', itemName: '鉄' },
        { spec: 'アルミ', categoryName: '階段', itemName: 'アルミ' },
        { spec: '3段', categoryName: '階段', itemName: '3段' },
        { spec: '階段下', categoryName: '階段', itemName: '階段下' },
    ]},
    { label: 'ジャッキ', rows: [
        { spec: '固定', categoryName: 'ジャッキ', itemName: '固定' },
        { spec: '下屋', categoryName: 'ジャッキ', itemName: '下屋' },
    ]},
    { label: '', rows: [
        { spec: '皿', categoryName: '皿 / 兼用皿', itemName: '皿' },
        { spec: '兼用皿', categoryName: '皿 / 兼用皿', itemName: '兼用皿' },
        { spec: 'ルーフベース', categoryName: 'ルーフベース', itemName: 'ルーフベース' },
    ]},
];

const COL2: Column = [
    { label: '単管', rows: [
        { spec: '6m', categoryName: '単管', itemName: '6m' },
        { spec: '5m', categoryName: '単管', itemName: '5m' },
        { spec: '4m', categoryName: '単管', itemName: '4m' },
        { spec: '3m', categoryName: '単管', itemName: '3m' },
        { spec: '2m', categoryName: '単管', itemName: '2m' },
        { spec: '1.5m', categoryName: '単管', itemName: '1.5m' },
        { spec: '1m', categoryName: '単管', itemName: '1m' },
        { spec: '0.5m', categoryName: '単管', itemName: '0.5m' },
    ]},
    { label: 'クランプ', rows: [
        { spec: '直交', categoryName: 'クランプ', itemName: '直交' },
        { spec: '自在', categoryName: 'クランプ', itemName: '自在' },
        { spec: '3連', categoryName: 'クランプ', itemName: '3連' },
        { spec: 'シート', categoryName: 'クランプ', itemName: 'シート' },
        { spec: '養生', categoryName: 'クランプ', itemName: '養生' },
    ]},
    { label: '鉄骨', rows: [
        { spec: '直交', categoryName: '鉄骨', itemName: '直交' },
        { spec: '自在', categoryName: '鉄骨', itemName: '自在' },
    ]},
    { label: '', rows: [
        { spec: 'ジョイント', categoryName: 'ジョイント', itemName: 'ジョイント' },
        { spec: '単管ベース', categoryName: '単管ベース', itemName: '単管ベース' },
    ]},
    { label: '', rows: [
        { spec: '新築用 青(紐付) 1.8', categoryName: 'ネット', itemName: '新築用 青(紐付) 1.8' },
        { spec: 'グレー 5.4・6.3 1.2', categoryName: 'ネット', itemName: 'グレー 5.4・6.3 1.2' },
        { spec: '青 黒 緑 0.9', categoryName: 'ネット', itemName: '青 黒 緑 0.9' },
        { spec: '白 0.6', categoryName: 'ネット', itemName: '白 0.6' },
    ]},
    { label: 'カヤシート', rows: [
        { spec: '1.8', categoryName: 'カヤシート', itemName: '1.8' },
        { spec: '3.6', categoryName: 'カヤシート', itemName: '3.6' },
    ]},
    { label: '', rows: [
        { spec: 'ヒモ', categoryName: 'ヒモ', itemName: 'ヒモ' },
    ]},
    { label: '壁つなぎ', rows: [
        { spec: '14～17', categoryName: '壁つなぎ', itemName: '14～17' },
        { spec: '19～24', categoryName: '壁つなぎ', itemName: '19～24' },
        { spec: '24～34', categoryName: '壁つなぎ', itemName: '24～34' },
        { spec: '33～52', categoryName: '壁つなぎ', itemName: '33～52' },
        { spec: '50～72', categoryName: '壁つなぎ', itemName: '50～72' },
        { spec: '70～92', categoryName: '壁つなぎ', itemName: '70～92' },
    ]},
    { label: '道板', rows: [
        { spec: '4m', categoryName: '道板', itemName: '4m' },
        { spec: '3m', categoryName: '道板', itemName: '3m' },
        { spec: '2m', categoryName: '道板', itemName: '2m' },
        { spec: '1m', categoryName: '道板', itemName: '1m' },
    ]},
    { label: '巾木（木製）', rows: [
        { spec: '4m', categoryName: '巾木（木製）', itemName: '4m' },
        { spec: '2m', categoryName: '巾木（木製）', itemName: '2m' },
    ]},
    { label: 'L型巾木', rows: [
        { spec: '1.8', categoryName: 'L型巾木', itemName: '1.8m' },
        { spec: '1.2', categoryName: 'L型巾木', itemName: '1.2m' },
        { spec: '0.9', categoryName: 'L型巾木', itemName: '0.9m' },
        { spec: '0.6', categoryName: 'L型巾木', itemName: '0.6m' },
    ]},
    { label: 'L型巾木(妻用)', rows: [
        { spec: '0.9', categoryName: 'L型巾木(妻用)', itemName: '0.9m' },
        { spec: '0.6', categoryName: 'L型巾木(妻用)', itemName: '0.6m' },
    ]},
    { label: 'アダプター', rows: [
        { spec: '柱用', categoryName: 'アダプター', itemName: '柱用' },
        { spec: 'アンチ', categoryName: 'アダプター', itemName: 'アンチ' },
    ]},
    { label: '', rows: [
        { spec: 'ジャッキカバー', categoryName: 'ジャッキカバー', itemName: 'ジャッキカバー' },
        { spec: 'コッパ', categoryName: 'コッパ', itemName: 'コッパ' },
        { spec: 'チョウチョ', categoryName: 'チョウチョ', itemName: 'チョウチョ' },
    ]},
];

const COL3: Column = [
    { label: '先行手摺', rows: [
        { spec: '1.8', categoryName: '先行手摺', itemName: '1.8m' },
        { spec: '1.2', categoryName: '先行手摺', itemName: '1.2m' },
        { spec: '0.9', categoryName: '先行手摺', itemName: '0.9m' },
        { spec: '0.6', categoryName: '先行手摺', itemName: '0.6m' },
    ]},
    { label: '梁枠', rows: [
        { spec: '3.6', categoryName: '梁枠', itemName: '3.6m' },
        { spec: '5.4', categoryName: '梁枠', itemName: '5.4m' },
    ]},
    { label: '', rows: [
        { spec: '安全バー', categoryName: '安全バー', itemName: '安全バー' },
        { spec: '金網', categoryName: '金網', itemName: '金網' },
        { spec: '杭', categoryName: '杭', itemName: '杭' },
        { spec: 'ローリングタイヤ', categoryName: 'ローリングタイヤ', itemName: 'ローリングタイヤ' },
        { spec: 'ハッチ付きアンチ', categoryName: 'ハッチ付きアンチ', itemName: 'ハッチ付きアンチ' },
        { spec: 'タラップ', categoryName: 'タラップ', itemName: 'タラップ' },
        { spec: '朝顔', categoryName: '朝顔', itemName: '朝顔' },
        { spec: '単クランプ', categoryName: '単クランプ', itemName: '単クランプ' },
        { spec: '羽子板クランプ', categoryName: '羽子板クランプ', itemName: '羽子板クランプ' },
        { spec: '親綱', categoryName: '親綱', itemName: '親綱' },
        { spec: '足場表示看板', categoryName: '足場表示看板', itemName: '足場表示看板' },
        { spec: 'イメージシート', categoryName: 'イメージシート', itemName: 'イメージシート' },
        { spec: 'ラッセルネット', categoryName: 'ラッセルネット', itemName: 'ラッセルネット' },
        { spec: '階段手摺', categoryName: '階段手摺', itemName: '階段手摺' },
        { spec: 'レール', categoryName: 'レール', itemName: 'レール' },
    ]},
    { label: '養生カバー', rows: [
        { spec: '大', categoryName: '養生カバー', itemName: '大' },
        { spec: '小', categoryName: '養生カバー', itemName: '小' },
    ]},
    { label: '番線', rows: [
        { spec: '巾木', categoryName: '番線', itemName: '巾木' },
        { spec: '巻き', categoryName: '番線', itemName: '巻き' },
    ]},
    { label: '', rows: [
        { spec: '扉', categoryName: '扉', itemName: '扉' },
    ]},
];

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
    // リース品セクション
    leasedSection: {
        marginTop: 4,
        borderWidth: 0.5,
        borderColor: '#000',
    },
    leasedHeader: {
        padding: 3,
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        fontSize: 9,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    leasedRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#999',
        minHeight: 13,
    },
    leasedLabel: {
        flex: 2,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        fontSize: 8,
    },
    leasedQty: {
        flex: 1,
        padding: 2,
        textAlign: 'center',
        fontSize: 9,
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
            {column.map((group, idx) => (
                <GroupBlock key={idx} group={group} getQty={getQty} isLastGroup={idx === column.length - 1} />
            ))}
        </View>
    );
}

/** 1ページ分の中身を描画 */
function SlipPageContent({
    foremanName, customerName, siteName, assemblyDate, demolitionDate, vehicles, getQty, leasedItems,
}: MaterialRequisitionSlipPDFProps) {
    const safeLeased = leasedItems && leasedItems.length > 0 ? leasedItems : Array.from({ length: 3 }, () => ({ label: '', qty: '' }));
    return (
        <>
            <Header foremanName={foremanName} />
            <MetaBox customerName={customerName} siteName={siteName} assemblyDate={assemblyDate} demolitionDate={demolitionDate} />
            <VehicleRow vehicles={vehicles} />

            <View style={styles.grid}>
                <ColumnBlock column={COL1} getQty={getQty} isLast={false} />
                <ColumnBlock column={COL2} getQty={getQty} isLast={false} />
                <ColumnBlock column={COL3} getQty={getQty} isLast={true} />
            </View>

            <View style={styles.leasedSection}>
                <Text style={styles.leasedHeader}>リース品</Text>
                {safeLeased.map((row, idx) => (
                    <View key={idx} style={styles.leasedRow}>
                        <Text style={styles.leasedLabel}>{sanitizePdfText(row.label)}</Text>
                        <Text style={styles.leasedQty}>{sanitizePdfText(row.qty)}</Text>
                    </View>
                ))}
            </View>
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
