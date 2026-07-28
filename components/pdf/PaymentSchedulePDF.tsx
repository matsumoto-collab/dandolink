'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { wrapTextToWidth } from '@/components/pdf/styles';
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
    // 手数料負担マーク（フォントのグリフに依存せず View で実体の赤丸を描画）
    feeCircle: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#dc2626',
    },
});

// カラム幅（A4横向き 765pt 使用可能領域に合わせて）
const COL = {
    po: 24,
    payee: 165,
    check1: 22,
    fee: 38, // ヘッダー「手数料」(3文字)が収まる幅
    amount: 75,
    check2: 22,
    bank: 75,
    branch: 65,
    type: 28,
    account: 60,
    holder: 190,
    check3: 22,
};

// 口座名義セルの内寸（width − 左右padding 4+4 − 右罫線 0.5）。長い名義はこの幅で折り返す
const HOLDER_CONTENT_WIDTH = COL.holder - 4 - 4 - 0.5;
const HOLDER_FONT_SIZE = 8.5; // = styles.cellTextLeft.fontSize

/**
 * テーブルの見出し行。fixed により改ページ後の各ページ先頭でも繰り返し描画される。
 *
 * ※ 以前は ROWS_PER_PAGE（固定22行）で Page を分けていたが、口座名義などの折り返しで
 *    行の高さが 26〜36pt と可変なため 1ページに 22 行は入らず、react-pdf の自動改ページで
 *    「ヘッダーもページ番号も無い中途半端なページ」が挟まっていた（kei報告 2026-07-28・
 *    39件で表示上は2ページなのに実際は4ページ）。行数ではなく実際の高さで折り返させ、
 *    ヘッダーを fixed で繰り返す方式に変更した＝溢れが原理的に起きない。
 */
function TableHeaderRow() {
    return (
        <View style={styles.headerRow} fixed>
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
    );
}

/** データ1行。wrap={false} でページ境界に行が割れないようにする。 */
function DataRow({ item, index }: { item: PaymentSchedule; index: number }) {
    const rowStyle = item.isPaid
        ? [styles.dataRow, styles.dataRowPaid]
        : index % 2 === 1
        ? [styles.dataRow, styles.dataRowEven]
        : [styles.dataRow];

    return (
                    <View style={rowStyle} wrap={false}>
                        <View style={[styles.cell, { width: COL.po }]}>
                            <Text style={styles.cellText}>{index + 1}</Text>
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
                            {item.feeFlag && <View style={styles.feeCircle} />}
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
                            <Text style={styles.cellTextLeft}>
                                {wrapTextToWidth(
                                    item.accountHolder ?? '',
                                    HOLDER_CONTENT_WIDTH,
                                    HOLDER_FONT_SIZE,
                                )}
                            </Text>
                        </View>
                        <View style={[styles.cell, { width: COL.check3, borderRightWidth: 0 }]}>
                            <View style={styles.checkbox}>
                                {item.isPaid && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                        </View>
        </View>
    );
}

export function PaymentSchedulePDF({ items, paymentDate }: PaymentSchedulePDFProps) {
    const total = items.reduce((s, x) => s + Number(x.amount), 0);
    const count = items.length;
    const titleText = formatReiwaTitle(paymentDate);

    // ページ分割は react-pdf の自動改ページに任せる（行の高さが可変なため行数では正しく割れない）。
    // ヘッダー・ページ番号・テーブル見出しは fixed で各ページの先頭に繰り返し描画される。
    return (
        <Document>
            <Page size="A4" orientation="landscape" style={styles.page}>
                {/* 上部ヘッダー: タイトル + 合計サマリー */}
                <View style={styles.header} fixed>
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

                {/* ページ番号（複数ページの場合のみ。実ページ数は描画時に確定するので render で出す） */}
                <Text
                    style={styles.pageInfo}
                    fixed
                    render={({ pageNumber, totalPages }) =>
                        totalPages > 1 ? `${pageNumber} / ${totalPages} ページ` : ''
                    }
                />

                <View style={styles.container}>
                    <TableHeaderRow />
                    {items.map((item, idx) => (
                        <DataRow key={item.id} item={item} index={idx} />
                    ))}
                </View>
            </Page>
        </Document>
    );
}
