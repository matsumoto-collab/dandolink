'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize, sanitizePdfText, toReiwa } from './styles';
import type { AssignmentSheetRow } from '@/lib/assignmentSheet';

export interface AssignmentSheetPDFProps {
    /** 対象日。 */
    date: Date;
    /** 手配表の行（buildAssignmentSheetRows の出力）。 */
    rows: AssignmentSheetRow[];
    /** 確認欄に並べる担当者（姓）。 */
    managers: string[];
    /** 備考欄に入れる任意テキスト（既定は空欄のまま）。 */
    headerNote?: string;
}

// A4 縦: 595.28 x 841.89pt。左右 padding 18 → 利用幅 559.28pt。
const COL = {
    manager: 38, // 担当
    order: 22, // 順番
    customer: 86, // 元請会社名
    title: 156, // 現場名
    foreman: 52, // 職長
    workers: 124, // 作業員名簿
    count: 26, // 人数
    vehicle: 55, // 車両
} as const;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        paddingTop: 16,
        paddingBottom: 40,
        paddingHorizontal: 18,
        backgroundColor: '#ffffff',
    },
    // ── タイトル + 備考 + 列見出し（各ページ上部に固定） ──
    headerBlock: {
        // fixed: 改ページ時も各ページの先頭に同じ見出しを繰り返す
    },
    titleBand: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#000000',
        minHeight: 30,
        paddingHorizontal: 6,
    },
    titleSpacer: { width: 150 },
    titleText: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: 'bold',
        letterSpacing: 2,
    },
    dateText: {
        width: 150,
        textAlign: 'right',
        fontSize: 11,
        fontWeight: 'bold',
    },
    noteBand: {
        flexDirection: 'row',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#000000',
        minHeight: 20,
    },
    noteEmptyCell: {
        width: COL.manager + COL.order + COL.customer,
        borderRightWidth: 1,
        borderRightColor: '#000000',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    noteRemarksCell: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    bandLabel: {
        fontSize: 8,
        color: '#374151',
    },
    noteValue: {
        fontSize: 8,
        marginLeft: 6,
        color: '#111111',
    },
    // ── テーブル ──
    headerRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: '#e5e7eb',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#000000',
        minHeight: 18,
    },
    dataRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 0.75,
        borderColor: '#000000',
        minHeight: 22,
    },
    unassignedRow: {
        backgroundColor: '#fff1f2',
    },
    groupGap: {
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 0.75,
        borderColor: '#000000',
        backgroundColor: '#f4f4f5',
        height: 7,
    },
    emptyRow: {
        flexDirection: 'row',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 0.75,
        borderColor: '#000000',
        minHeight: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: { fontSize: 9, color: '#9ca3af' },
    cell: {
        borderRightWidth: 0.5,
        borderRightColor: '#9ca3af',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 3,
        paddingVertical: 1,
    },
    cellLast: {
        borderRightWidth: 0,
    },
    headerText: {
        fontSize: 8,
        fontWeight: 'bold',
        textAlign: 'center',
        width: '100%',
    },
    // ── 確認欄（各ページ下部に固定） ──
    footer: {
        position: 'absolute',
        bottom: 14,
        left: 18,
        right: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    footerLabel: {
        fontSize: 9,
        marginRight: 10,
        color: '#111111',
    },
    checkItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 14,
    },
    checkBox: {
        width: 9,
        height: 9,
        borderWidth: 0.8,
        borderColor: '#111111',
        marginRight: 4,
    },
    checkName: {
        fontSize: 9,
        color: '#111111',
    },
});

/** セル内寸（幅 − 左右 padding − 右罫線）。 */
const contentWidth = (w: number) => w - 7;

/** セルに1行で収まるフォントサイズ（収まらなければ最小までは縮小）。 */
const fit = (text: string, w: number, base: number, min = 6) =>
    fitCellFontSize(sanitizePdfText(text || ''), contentWidth(w), base, min);

type CellAlign = 'left' | 'center' | 'right';

function Cell({
    width,
    align = 'left',
    last,
    fontSize,
    color,
    bold,
    children,
}: {
    width: number;
    align?: CellAlign;
    last?: boolean;
    fontSize: number;
    color?: string;
    bold?: boolean;
    children?: React.ReactNode;
}) {
    const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    return (
        <View style={[styles.cell, ...(last ? [styles.cellLast] : []), { width, justifyContent: justify }]}>
            <Text
                style={{
                    fontSize,
                    textAlign: align,
                    color: color || '#111111',
                    fontWeight: bold ? 'bold' : 'normal',
                }}
            >
                {children}
            </Text>
        </View>
    );
}

function HeaderRow() {
    const labels: [string, number, boolean?][] = [
        ['担当', COL.manager],
        ['順番', COL.order],
        ['元請会社名', COL.customer],
        ['現場名', COL.title],
        ['職長', COL.foreman],
        ['作業員名簿', COL.workers],
        ['人数', COL.count],
        ['車両', COL.vehicle, true],
    ];
    return (
        <View style={styles.headerRow} fixed>
            {labels.map(([label, width, last]) => (
                <View key={label} style={[styles.cell, ...(last ? [styles.cellLast] : []), { width, justifyContent: 'center' }]}>
                    <Text style={styles.headerText}>{label}</Text>
                </View>
            ))}
        </View>
    );
}

function DataRow({ row }: { row: AssignmentSheetRow }) {
    const members = row.memberNames.join('　');
    const vehicles = row.vehicleNames.join(' ');
    const foreman = row.sameForemanAsAbove ? '〃' : row.foremanName;
    return (
        <View style={[styles.dataRow, ...(row.isUnassigned ? [styles.unassignedRow] : [])]} wrap={false}>
            <Cell width={COL.manager} align="center" fontSize={fit(row.managerLabel || '', COL.manager, 8, 6)} bold>
                {row.managerLabel || ''}
            </Cell>
            <Cell width={COL.order} align="center" fontSize={8.5}>
                {row.orderInGroup}
            </Cell>
            <Cell width={COL.customer} fontSize={fit(row.customer, COL.customer, 8, 5.5)} color={row.color}>
                {row.customer}
            </Cell>
            <Cell width={COL.title} fontSize={fit(row.title, COL.title, 9, 6)} color={row.color} bold>
                {row.title}
            </Cell>
            <Cell width={COL.foreman} align="center" fontSize={fit(foreman, COL.foreman, 8, 5.5)} bold={row.sameForemanAsAbove}>
                {foreman}
            </Cell>
            <Cell width={COL.workers} fontSize={fit(members, COL.workers, 8, 5.5)}>
                {members}
            </Cell>
            <Cell width={COL.count} align="center" fontSize={9} bold>
                {row.memberCount > 0 ? row.memberCount : ''}
            </Cell>
            <Cell width={COL.vehicle} align="center" last fontSize={fit(vehicles, COL.vehicle, 7.5, 5.5)}>
                {vehicles}
            </Cell>
        </View>
    );
}

export function AssignmentSheetPDF({ date, rows, managers, headerNote }: AssignmentSheetPDFProps) {
    const dateLabel = `${toReiwa(date, { space: true })}（${WEEKDAYS[date.getDay()]}）`;
    return (
        <Document>
            <Page size="A4" orientation="portrait" style={styles.page}>
                {/* タイトル + 備考（1ページ目のみ。列見出しは下の HeaderRow が各ページ先頭で繰り返す） */}
                <View style={styles.headerBlock}>
                    <View style={styles.titleBand}>
                        <View style={styles.titleSpacer} />
                        <Text style={styles.titleText}>作　業　日　報</Text>
                        <Text style={styles.dateText}>{dateLabel}</Text>
                    </View>
                    <View style={styles.noteBand}>
                        <View style={styles.noteEmptyCell}>
                            <Text style={styles.bandLabel}>空き</Text>
                        </View>
                        <View style={styles.noteRemarksCell}>
                            <Text style={styles.bandLabel}>備考</Text>
                            {headerNote ? <Text style={styles.noteValue}>{headerNote}</Text> : null}
                        </View>
                    </View>
                </View>

                <HeaderRow />

                {rows.length === 0 ? (
                    <View style={styles.emptyRow}>
                        <Text style={styles.emptyText}>当日の予定はありません</Text>
                    </View>
                ) : (
                    rows.map((row, idx) => (
                        <React.Fragment key={row.projectId}>
                            {row.foremanChanged && idx > 0 ? <View style={styles.groupGap} /> : null}
                            <DataRow row={row} />
                        </React.Fragment>
                    ))
                )}

                {/* 確認欄（各ページ下部に固定） */}
                <View style={styles.footer} fixed>
                    <Text style={styles.footerLabel}>確認</Text>
                    {managers.map((m) => (
                        <View key={m} style={styles.checkItem}>
                            <View style={styles.checkBox} />
                            <Text style={styles.checkName}>{m}</Text>
                        </View>
                    ))}
                </View>
            </Page>
        </Document>
    );
}
