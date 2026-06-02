'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import type { PaymentSchedule } from '@/types/paymentSchedule';

interface PaymentSchedulePDFProps {
    items: PaymentSchedule[];
    paymentDate: string; // YYYY-MM-DD
}

// 月末判定
const isEndOfMonth = (d: Date): boolean => {
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return next.getMonth() !== d.getMonth();
};

// 「令和8年4月末日支払分」のような表記を生成
const formatReiwaTitle = (dateStr: string): string => {
    const d = new Date(dateStr);
    const reiwaY = d.getFullYear() - 2018;
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayLabel = isEndOfMonth(d) ? '末日' : `${day}日`;
    return `令和${reiwaY}年${month}月${dayLabel} 支払分`;
};

const formatYen = (n: number | string) => {
    const v = typeof n === 'string' ? Number(n) : n;
    if (isNaN(v) || v === 0) return '';
    return v.toLocaleString();
};

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 9,
        padding: 24,
        backgroundColor: '#ffffff',
    },
    // 上部ヘッダー
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 12,
    },
    headerLeft: {
        flex: 1,
    },
    docTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    docSubtitle: {
        fontSize: 13,
        color: '#374151',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 16,
    },
    summaryBox: {
        borderWidth: 1,
        borderColor: '#000000',
        paddingVertical: 6,
        paddingHorizontal: 10,
        minWidth: 110,
    },
    summaryLabel: {
        fontSize: 8,
        color: '#6b7280',
        marginBottom: 1,
    },
    summaryValue: {
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'right',
    },
    summaryValueRed: {
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'right',
        color: '#dc2626',
    },
    // ページ情報
    pageInfo: {
        fontSize: 9,
        color: '#6b7280',
        textAlign: 'right',
        marginBottom: 4,
    },
    // テーブル
    container: {
        borderWidth: 1,
        borderColor: '#000000',
    },
    headerRow: {
        flexDirection: 'row',
        backgroundColor: '#e5e7eb',
        borderBottomWidth: 1,
        borderBottomColor: '#000000',
        minHeight: 24,
    },
    dataRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#9ca3af',
        minHeight: 26,
    },
    dataRowEven: {
        backgroundColor: '#fafafa',
    },
    dataRowPaid: {
        backgroundColor: '#f0fdf4',
    },
    cell: {
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#9ca3af',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cellText: {
        fontSize: 8.5,
        textAlign: 'center',
    },
    cellTextLeft: {
        fontSize: 8.5,
        textAlign: 'left',
    },
    cellTextRight: {
        fontSize: 9.5,
        textAlign: 'right',
        fontWeight: 'bold',
    },
    headerText: {
        fontSize: 9,
        textAlign: 'center',
        fontWeight: 'bold',
    },
    // チェックボックス
    checkbox: {
        width: 12,
        height: 12,
        borderWidth: 0.7,
        borderColor: '#000000',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkmark: {
        fontSize: 12,
        color: '#16a34a',
        fontWeight: 'bold',
        lineHeight: 1,
    },
    redDot: {
        fontSize: 13,
        color: '#dc2626',
        textAlign: 'center',
        lineHeight: 1,
    },
});

// カラム幅（A4横向き 765pt 使用可能領域に合わせて）
const COL = {
    po: 24,
    payee: 165,
    check1: 22,
    fee: 28,
    amount: 75,
    check2: 22,
    bank: 75,
    branch: 65,
    type: 28,
    account: 60,
    holder: 110,
    check3: 22,
};

const ROWS_PER_PAGE = 22;

interface PageContentProps {
    rows: PaymentSchedule[];
    startIndex: number;
}

function TableContent({ rows, startIndex }: PageContentProps) {
    return (
        <View style={styles.container}>
            {/* ヘッダー行 */}
            <View style={styles.headerRow}>
                <View style={[styles.cell, { width: COL.po }]}>
                    <Text style={styles.headerText}>No.</Text>
                </View>
                <View style={[styles.cell, { width: COL.payee }]}>
                    <Text style={styles.headerText}>入金先</Text>
                </View>
                <View style={[styles.cell, { width: COL.check1 }]}>
                    <View style={styles.checkbox} />
                </View>
                <View style={[styles.cell, { width: COL.fee }]}>
                    <Text style={styles.headerText}>手数料</Text>
                </View>
                <View style={[styles.cell, { width: COL.amount }]}>
                    <Text style={styles.headerText}>入金額</Text>
                </View>
                <View style={[styles.cell, { width: COL.check2 }]}>
                    <View style={styles.checkbox} />
                </View>
                <View style={[styles.cell, { width: COL.bank }]}>
                    <Text style={styles.headerText}>銀行名</Text>
                </View>
                <View style={[styles.cell, { width: COL.branch }]}>
                    <Text style={styles.headerText}>支店名</Text>
                </View>
                <View style={[styles.cell, { width: COL.type }]}>
                    <Text style={styles.headerText}>種別</Text>
                </View>
                <View style={[styles.cell, { width: COL.account }]}>
                    <Text style={styles.headerText}>口座番号</Text>
                </View>
                <View style={[styles.cell, { width: COL.holder }]}>
                    <Text style={styles.headerText}>口座名義</Text>
                </View>
                <View style={[styles.cell, { width: COL.check3, borderRightWidth: 0 }]}>
                    <View style={styles.checkbox} />
                </View>
            </View>

            {/* データ行 */}
            {rows.map((item, idx) => {
                const rowStyle = item.isPaid
                    ? [styles.dataRow, styles.dataRowPaid]
                    : idx % 2 === 1
                    ? [styles.dataRow, styles.dataRowEven]
                    : [styles.dataRow];

                return (
                    <View key={item.id} style={rowStyle} wrap={false}>
                        <View style={[styles.cell, { width: COL.po }]}>
                            <Text style={styles.cellText}>{startIndex + idx + 1}</Text>
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.payee, paddingLeft: 6, justifyContent: 'flex-start' },
                            ]}
                        >
                            <Text style={styles.cellTextLeft}>{item.payeeName}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.check1 }]}>
                            <View style={styles.checkbox}>
                                {item.isPaid && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                        </View>
                        <View style={[styles.cell, { width: COL.fee }]}>
                            {item.feeFlag && <Text style={styles.redDot}>●</Text>}
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.amount, paddingRight: 6, justifyContent: 'flex-end' },
                            ]}
                        >
                            <Text style={styles.cellTextRight}>{formatYen(item.amount)}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.check2 }]}>
                            <View style={styles.checkbox}>
                                {item.isPaid && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.bank, paddingLeft: 5, justifyContent: 'flex-start' },
                            ]}
                        >
                            <Text style={styles.cellTextLeft}>{item.bankName ?? ''}</Text>
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.branch, paddingLeft: 5, justifyContent: 'flex-start' },
                            ]}
                        >
                            <Text style={styles.cellTextLeft}>{item.branchName ?? ''}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.type }]}>
                            <Text style={styles.cellText}>{item.accountType ?? ''}</Text>
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.account, paddingRight: 5, justifyContent: 'flex-end' },
                            ]}
                        >
                            <Text style={styles.cellTextRight}>{item.accountNumber ?? ''}</Text>
                        </View>
                        <View
                            style={[
                                styles.cell,
                                { width: COL.holder, paddingLeft: 4, justifyContent: 'flex-start' },
                            ]}
                        >
                            <Text style={styles.cellTextLeft}>{item.accountHolder ?? ''}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.check3, borderRightWidth: 0 }]}>
                            <View style={styles.checkbox}>
                                {item.isPaid && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

export function PaymentSchedulePDF({ items, paymentDate }: PaymentSchedulePDFProps) {
    const total = items.reduce((s, x) => s + Number(x.amount), 0);
    const count = items.length;
    const titleText = formatReiwaTitle(paymentDate);

    // ページ分割
    const pages: PaymentSchedule[][] = [];
    for (let i = 0; i < items.length; i += ROWS_PER_PAGE) {
        pages.push(items.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    return (
        <Document>
            {pages.map((pageItems, pageIdx) => {
                const startIndex = pageIdx * ROWS_PER_PAGE;
                return (
                    <Page key={pageIdx} size="A4" orientation="landscape" style={styles.page}>
                        {/* 上部ヘッダー: タイトル + 合計サマリー */}
                        <View style={styles.header}>
                            <View style={styles.headerLeft}>
                                <Text style={styles.docTitle}>支払予定表</Text>
                                <Text style={styles.docSubtitle}>{titleText}</Text>
                            </View>
                            <View style={styles.headerRight}>
                                <View style={styles.summaryBox}>
                                    <Text style={styles.summaryLabel}>件数</Text>
                                    <Text style={styles.summaryValueRed}>{count} 件</Text>
                                </View>
                                <View style={styles.summaryBox}>
                                    <Text style={styles.summaryLabel}>合計金額</Text>
                                    <Text style={styles.summaryValue}>¥{total.toLocaleString()}</Text>
                                </View>
                            </View>
                        </View>

                        {/* ページ番号（複数ページの場合のみ） */}
                        {pages.length > 1 && (
                            <Text style={styles.pageInfo}>
                                {pageIdx + 1} / {pages.length} ページ
                            </Text>
                        )}

                        <TableContent rows={pageItems} startIndex={startIndex} />
                    </Page>
                );
            })}
        </Document>
    );
}
