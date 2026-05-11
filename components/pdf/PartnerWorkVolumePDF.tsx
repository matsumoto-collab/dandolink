'use client';

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

export interface PartnerWorkVolumePdfRow {
    date: string; // YYYY-MM-DD
    customerName: string | null;
    projectTitle: string;
    managerName: string | null;
    constructionContent: string | null;
    amount: number;
    notes: string | null;
}

export interface PartnerWorkVolumePDFProps {
    partnerCompanyName: string;
    year: number;
    month: number;
    rows: PartnerWorkVolumePdfRow[];
}

const formatYen = (n: number): string => {
    if (!Number.isFinite(n) || n === 0) return '';
    return n.toLocaleString('ja-JP');
};

const formatDate = (s: string): string => {
    // YYYY-MM-DD → M/D
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    return `${Number(m[1])}/${Number(m[2])}`;
};

const formatReiwa = (year: number, month: number): string => {
    const reiwaY = year - 2018;
    return `令和${reiwaY}年${month}月`;
};

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        paddingTop: 20,
        paddingBottom: 20,
        paddingHorizontal: 18,
        backgroundColor: '#ffffff',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 8,
    },
    headerLeft: {
        flex: 1,
    },
    docTitle: {
        fontSize: 15,
        fontWeight: 'bold',
        marginBottom: 2,
    },
    docSubtitle: {
        fontSize: 10,
        color: '#374151',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 6,
    },
    summaryBox: {
        borderWidth: 1,
        borderColor: '#000000',
        paddingVertical: 3,
        paddingHorizontal: 6,
        minWidth: 92,
    },
    summaryLabel: {
        fontSize: 7,
        color: '#6b7280',
    },
    summaryValue: {
        fontSize: 11,
        fontWeight: 'bold',
        textAlign: 'right',
    },
    pageInfo: {
        fontSize: 8,
        color: '#6b7280',
        textAlign: 'right',
        marginBottom: 3,
    },
    container: {
        borderWidth: 1,
        borderColor: '#000000',
    },
    headerRow: {
        flexDirection: 'row',
        backgroundColor: '#e5e7eb',
        borderBottomWidth: 1,
        borderBottomColor: '#000000',
        minHeight: 18,
    },
    dataRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#9ca3af',
        minHeight: 17,
    },
    dataRowEven: {
        backgroundColor: '#fafafa',
    },
    totalRow: {
        flexDirection: 'row',
        backgroundColor: '#f0f0f0',
        borderTopWidth: 1,
        borderTopColor: '#000000',
        minHeight: 20,
    },
    cell: {
        paddingVertical: 2,
        paddingHorizontal: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#9ca3af',
        flexDirection: 'row',
        alignItems: 'center',
    },
    cellLast: {
        paddingVertical: 2,
        paddingHorizontal: 3,
        flexDirection: 'row',
        alignItems: 'center',
    },
    cellCenter: { justifyContent: 'center' },
    cellLeft: { justifyContent: 'flex-start' },
    cellRight: { justifyContent: 'flex-end' },
    cellText: { fontSize: 7.5 },
    cellTextCenter: { fontSize: 7.5, textAlign: 'center' },
    cellTextRight: { fontSize: 8, textAlign: 'right', fontWeight: 'bold' },
    headerText: {
        fontSize: 8,
        textAlign: 'center',
        fontWeight: 'bold',
    },
    totalLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        textAlign: 'right',
        width: '100%',
        paddingRight: 4,
    },
    totalAmount: {
        fontSize: 10,
        fontWeight: 'bold',
        textAlign: 'right',
        width: '100%',
        paddingRight: 4,
    },
});

// A4 縦向き: ページ幅 595pt - padding 36pt = 559pt 利用可能
const COL = {
    no: 22,
    date: 36,
    customer: 92,
    project: 145,
    manager: 50,
    content: 56,
    amount: 70,
    notes: 88,
};

// A4 縦向き: ページ高 842pt から header/footer 引いた残り ÷ 行高(17pt) で約 38 行
const ROWS_PER_PAGE = 38;

interface PageContentProps {
    rows: PartnerWorkVolumePdfRow[];
    startIndex: number;
    isLastPage: boolean;
    totalAmount: number;
}

function TableContent({ rows, startIndex, isLastPage, totalAmount }: PageContentProps) {
    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <View style={[styles.cell, styles.cellCenter, { width: COL.no }]}>
                    <Text style={styles.headerText}>No.</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.date }]}>
                    <Text style={styles.headerText}>日付</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.customer }]}>
                    <Text style={styles.headerText}>元請会社</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.project }]}>
                    <Text style={styles.headerText}>現場名</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.manager }]}>
                    <Text style={styles.headerText}>担当者</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.content }]}>
                    <Text style={styles.headerText}>作業内容</Text>
                </View>
                <View style={[styles.cell, styles.cellCenter, { width: COL.amount }]}>
                    <Text style={styles.headerText}>金額</Text>
                </View>
                <View style={[styles.cellLast, styles.cellCenter, { width: COL.notes }]}>
                    <Text style={styles.headerText}>備考</Text>
                </View>
            </View>

            {rows.map((row, idx) => {
                const isEven = idx % 2 === 1;
                const rowStyle = isEven ? [styles.dataRow, styles.dataRowEven] : [styles.dataRow];
                return (
                    <View key={`${startIndex}-${idx}`} style={rowStyle} wrap={false}>
                        <View style={[styles.cell, styles.cellCenter, { width: COL.no }]}>
                            <Text style={styles.cellTextCenter}>{startIndex + idx + 1}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellCenter, { width: COL.date }]}>
                            <Text style={styles.cellTextCenter}>{formatDate(row.date)}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellLeft, { width: COL.customer, paddingLeft: 6 }]}>
                            <Text style={styles.cellText}>{row.customerName ?? ''}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellLeft, { width: COL.project, paddingLeft: 6 }]}>
                            <Text style={styles.cellText}>{row.projectTitle}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellCenter, { width: COL.manager }]}>
                            <Text style={styles.cellTextCenter}>{row.managerName ?? ''}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellCenter, { width: COL.content }]}>
                            <Text style={styles.cellTextCenter}>{row.constructionContent ?? ''}</Text>
                        </View>
                        <View style={[styles.cell, styles.cellRight, { width: COL.amount, paddingRight: 6 }]}>
                            <Text style={styles.cellTextRight}>{formatYen(row.amount)}</Text>
                        </View>
                        <View style={[styles.cellLast, styles.cellLeft, { width: COL.notes, paddingLeft: 6 }]}>
                            <Text style={styles.cellText}>{row.notes ?? ''}</Text>
                        </View>
                    </View>
                );
            })}

            {isLastPage && (
                <View style={styles.totalRow} wrap={false}>
                    <View style={[styles.cell, styles.cellRight, { width: COL.no + COL.date + COL.customer + COL.project + COL.manager + COL.content }]}>
                        <Text style={styles.totalLabel}>合計</Text>
                    </View>
                    <View style={[styles.cell, styles.cellRight, { width: COL.amount, paddingRight: 6 }]}>
                        <Text style={styles.totalAmount}>{formatYen(totalAmount)}</Text>
                    </View>
                    <View style={[styles.cellLast, { width: COL.notes }]}>
                        <Text />
                    </View>
                </View>
            )}
        </View>
    );
}

export function PartnerWorkVolumePDF({ partnerCompanyName, year, month, rows }: PartnerWorkVolumePDFProps) {
    const totalAmount = rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    const count = rows.length;

    const pages: PartnerWorkVolumePdfRow[][] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
        pages.push(rows.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    const subtitle = `${formatReiwa(year, month)} 分　${partnerCompanyName}`;

    return (
        <Document>
            {pages.map((pageRows, pageIdx) => {
                const startIndex = pageIdx * ROWS_PER_PAGE;
                const isLastPage = pageIdx === pages.length - 1;
                return (
                    <Page key={pageIdx} size="A4" orientation="portrait" style={styles.page}>
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.docTitle}>出来高表</Text>
                                <Text style={styles.docSubtitle}>{subtitle}</Text>
                            </View>
                            <View style={styles.headerRight}>
                                <View style={styles.summaryBox}>
                                    <Text style={styles.summaryLabel}>件数</Text>
                                    <Text style={styles.summaryValue}>{count} 件</Text>
                                </View>
                                <View style={styles.summaryBox}>
                                    <Text style={styles.summaryLabel}>合計金額</Text>
                                    <Text style={styles.summaryValue}>¥{totalAmount.toLocaleString()}</Text>
                                </View>
                            </View>
                        </View>

                        {pages.length > 1 && (
                            <Text style={styles.pageInfo}>
                                {pageIdx + 1} / {pages.length} ページ
                            </Text>
                        )}

                        <TableContent
                            rows={pageRows}
                            startIndex={startIndex}
                            isLastPage={isLastPage}
                            totalAmount={totalAmount}
                        />
                    </Page>
                );
            })}
        </Document>
    );
}
