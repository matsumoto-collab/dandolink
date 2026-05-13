import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { sanitizePdfText } from '@/components/pdf/styles';

// 印刷PDFが扱う最小限の型（API側で組み立てる）
export interface RequisitionPrintItem {
    name: string;
    spec: string | null;
    unit: string;
    quantity: number;
    sortOrder?: number;
}

export interface RequisitionPrintCategory {
    categoryId: string;
    categoryName: string;
    items: RequisitionPrintItem[];
}

export interface RequisitionPrintData {
    id: string;
    projectTitle: string;
    date: string; // ISO
    foremanName: string;
    vehicleInfo: string | null;
    status: string;
    statusLabel: string;
    notes: string | null;
    typeLabel: string;
    categories: RequisitionPrintCategory[];
}

export interface MaterialRequisitionPrintPDFProps {
    requisitions: RequisitionPrintData[];
    generatedAt: string; // ISO
}

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 11,
        padding: 28,
        backgroundColor: '#ffffff',
    },
    titleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 10,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    titleSub: {
        fontSize: 9,
        color: '#525252',
    },
    headerBox: {
        borderWidth: 1,
        borderColor: '#333333',
        padding: 8,
        marginBottom: 10,
    },
    headerGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    headerCell: {
        flexDirection: 'row',
        width: '50%',
        paddingVertical: 2,
        paddingRight: 6,
    },
    headerLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#374151',
        width: 70,
    },
    headerValue: {
        fontSize: 11,
        flex: 1,
        flexWrap: 'wrap',
    },
    notesRow: {
        flexDirection: 'row',
        marginTop: 4,
    },
    notesLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#374151',
        width: 70,
    },
    notesValue: {
        fontSize: 10,
        flex: 1,
        flexWrap: 'wrap',
    },
    categoryBlock: {
        marginBottom: 10,
    },
    categoryHeader: {
        backgroundColor: '#e5e7eb',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderWidth: 0.5,
        borderColor: '#333333',
    },
    categoryName: {
        fontSize: 12,
        fontWeight: 'bold',
    },
    itemTable: {
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderColor: '#333333',
    },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 26,
        borderBottomWidth: 0.5,
        borderBottomColor: '#9ca3af',
        paddingHorizontal: 6,
    },
    emptyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 22,
        borderBottomWidth: 0.5,
        borderBottomColor: '#d4d4d4',
        paddingHorizontal: 6,
    },
    checkbox: {
        width: 14,
        height: 14,
        borderWidth: 1,
        borderColor: '#000000',
        marginRight: 8,
    },
    itemName: {
        fontSize: 12,
        flex: 1,
    },
    itemSpec: {
        fontSize: 9,
        color: '#525252',
        marginLeft: 4,
    },
    qtyBox: {
        flexDirection: 'row',
        alignItems: 'baseline',
        minWidth: 70,
        justifyContent: 'flex-end',
    },
    qty: {
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'right',
    },
    unit: {
        fontSize: 10,
        marginLeft: 3,
        color: '#374151',
    },
    footer: {
        position: 'absolute',
        bottom: 18,
        left: 28,
        right: 28,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 8,
        color: '#6b7280',
    },
});

// 西暦+和暦の併記
function formatDateJa(dateIso: string): string {
    const d = new Date(dateIso);
    if (isNaN(d.getTime())) return dateIso;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const reiwaY = y - 2018;
    return `${y}年${m}月${day}日（令和${reiwaY}年）`;
}

function formatDateTime(dateIso: string): string {
    const d = new Date(dateIso);
    if (isNaN(d.getTime())) return dateIso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safe(text: string | null | undefined): string {
    if (!text) return '';
    return sanitizePdfText(text);
}

// 紙運用での視認性のため空欄は em ダッシュで埋める
function safeOrDash(text: string | null | undefined): string {
    const s = safe(text);
    return s ? s : '—';
}

// type ラベルからタイトル文字列を組み立てる（返却伝票でも適切に表示される）
function buildTitle(typeLabel: string): string {
    const t = (typeLabel || '').trim();
    if (!t) return '材料チェックリスト';
    if (t === '返却') return '材料返却チェックリスト';
    return `材料${t}チェックリスト`;
}

// 1伝票分のページ
function RequisitionPage({ data, generatedAt }: { data: RequisitionPrintData; generatedAt: string }) {
    // 数量 > 0 の品目だけを残す（カテゴリも空ならスキップ）
    const filteredCategories = data.categories
        .map((cat) => ({
            ...cat,
            items: cat.items.filter((it) => it.quantity > 0),
        }))
        .filter((cat) => cat.items.length > 0);

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            {/* タイトル */}
            <View style={styles.titleRow}>
                <Text style={styles.title}>{safe(buildTitle(data.typeLabel))}</Text>
                <Text style={styles.titleSub}>区分: {safe(data.typeLabel)} / 状態: {safe(data.statusLabel)}</Text>
            </View>

            {/* ヘッダー情報 */}
            <View style={styles.headerBox}>
                <View style={styles.headerGrid}>
                    <View style={styles.headerCell}>
                        <Text style={styles.headerLabel}>現場</Text>
                        <Text style={styles.headerValue}>{safeOrDash(data.projectTitle)}</Text>
                    </View>
                    <View style={styles.headerCell}>
                        <Text style={styles.headerLabel}>日付</Text>
                        <Text style={styles.headerValue}>{formatDateJa(data.date)}</Text>
                    </View>
                    <View style={styles.headerCell}>
                        <Text style={styles.headerLabel}>職長</Text>
                        <Text style={styles.headerValue}>{safeOrDash(data.foremanName)}</Text>
                    </View>
                    <View style={styles.headerCell}>
                        <Text style={styles.headerLabel}>車両</Text>
                        <Text style={styles.headerValue}>{safeOrDash(data.vehicleInfo)}</Text>
                    </View>
                </View>
                {data.notes ? (
                    <View style={styles.notesRow}>
                        <Text style={styles.notesLabel}>備考</Text>
                        <Text style={styles.notesValue}>{safe(data.notes)}</Text>
                    </View>
                ) : null}
            </View>

            {/* カテゴリ別品目リスト */}
            {filteredCategories.length === 0 ? (
                <View style={{ padding: 12 }}>
                    <Text style={{ fontSize: 11, color: '#6b7280' }}>入力された品目はありません。</Text>
                </View>
            ) : (
                filteredCategories.map((cat) => (
                    <View key={cat.categoryId} style={styles.categoryBlock} wrap={false}>
                        <View style={styles.categoryHeader}>
                            <Text style={styles.categoryName}>{safe(cat.categoryName)}</Text>
                        </View>
                        <View style={styles.itemTable}>
                            {cat.items.map((item, idx) => (
                                <View key={`${cat.categoryId}-${idx}`} style={styles.itemRow}>
                                    <View style={styles.checkbox} />
                                    <Text style={styles.itemName}>
                                        {safe(item.name)}
                                        {item.spec ? (
                                            <Text style={styles.itemSpec}> {safe(item.spec)}</Text>
                                        ) : null}
                                    </Text>
                                    <View style={styles.qtyBox}>
                                        <Text style={styles.qty}>{item.quantity}</Text>
                                        <Text style={styles.unit}>{safe(item.unit)}</Text>
                                    </View>
                                </View>
                            ))}
                            {/* 書き足し用空行 */}
                            <View style={styles.emptyRow}>
                                <View style={styles.checkbox} />
                                <Text style={styles.itemName}> </Text>
                            </View>
                            <View style={styles.emptyRow}>
                                <View style={styles.checkbox} />
                                <Text style={styles.itemName}> </Text>
                            </View>
                        </View>
                    </View>
                ))
            )}

            {/* フッター */}
            <View style={styles.footer} fixed>
                <Text>出力: {formatDateTime(generatedAt)}</Text>
                <Text
                    render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
                />
            </View>
        </Page>
    );
}

export function MaterialRequisitionPrintPDF({
    requisitions,
    generatedAt,
}: MaterialRequisitionPrintPDFProps) {
    return (
        <Document>
            {requisitions.map((req) => (
                <RequisitionPage key={req.id} data={req} generatedAt={generatedAt} />
            ))}
        </Document>
    );
}
