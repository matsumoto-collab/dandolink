'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize, sanitizePdfText } from './styles';
import { SafetyDocHeader } from './SafetyDocHeader';
import {
    chunkMeiboWorkers,
    isoDateToReiwa,
    TODOKE_ROWS_PER_PAGE,
    type KikaiTodokeData,
    type MachineSnapshot,
} from '@/lib/safetyDocuments';

/**
 * 持込機械等使用届 PDF（全建統一様式 参考様式 準拠・A4横・押印欄なし・一覧形式）。
 * スナップショット（SafetyDocument.data）のみを入力にとる（FR-4-2）。
 * 1ページ12台で自動改ページ・ヘッダーは各ページに再掲。
 */

export interface KikaiTodokePDFProps {
    data: KikaiTodokeData;
}

// A4 横: 利用幅 ~800pt
const COL = {
    no: 24,
    name: 110,       // 機械名
    model: 90,       // 型式
    serial: 90,      // 製造番号
    maker: 80,       // メーカー
    capacity: 70,    // 能力
    owner: 100,      // 所有会社
    inspection: 70,  // 定期自主検査日
    operator: 90,    // 取扱者
    notes: 76,       // 備考
} as const;

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 7,
        paddingTop: 18,
        paddingBottom: 16,
        paddingHorizontal: 20,
        backgroundColor: '#ffffff',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: '#e5e7eb',
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#000000',
        minHeight: 20,
    },
    dataRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 0.75,
        borderColor: '#000000',
        minHeight: 34,
    },
    cell: {
        borderRightWidth: 0.5,
        borderRightColor: '#6b7280',
        paddingHorizontal: 2,
        paddingVertical: 1,
        justifyContent: 'center',
    },
    cellLast: { borderRightWidth: 0 },
    headerText: {
        fontSize: 6.5,
        fontWeight: 'bold',
        textAlign: 'center',
        width: '100%',
    },
    note: {
        marginTop: 4,
        fontSize: 5.5,
        color: '#374151',
    },
    pageNumber: {
        position: 'absolute',
        bottom: 6,
        right: 20,
        fontSize: 6.5,
        color: '#374151',
    },
});

const contentWidth = (w: number) => w - 5;
const fit = (text: string, w: number, base: number, min = 4.5) =>
    fitCellFontSize(sanitizePdfText(text || ''), contentWidth(w), base, min);

function Line({ text, width, base, bold }: { text: string; width: number; base: number; bold?: boolean }) {
    return (
        <Text style={{ fontSize: fit(text, width, base), fontWeight: bold ? 'bold' : 'normal', color: '#111111' }}>
            {text}
        </Text>
    );
}

function HeaderCells() {
    const labels: { label: string; width: number; last?: boolean }[] = [
        { label: '№', width: COL.no },
        { label: '機械名', width: COL.name },
        { label: '型式', width: COL.model },
        { label: '製造番号', width: COL.serial },
        { label: 'メーカー', width: COL.maker },
        { label: '能力', width: COL.capacity },
        { label: '所有会社', width: COL.owner },
        { label: '定期自主\n検査日', width: COL.inspection },
        { label: '取扱者', width: COL.operator },
        { label: '備考', width: COL.notes, last: true },
    ];
    return (
        <View style={styles.headerRow}>
            {labels.map(({ label, width, last }) => (
                <View key={label} style={[styles.cell, ...(last ? [styles.cellLast] : []), { width, justifyContent: 'center' }]}>
                    <Text style={styles.headerText}>{label}</Text>
                </View>
            ))}
        </View>
    );
}

function MachineRow({ machine, index }: { machine: MachineSnapshot; index: number }) {
    return (
        <View style={styles.dataRow} wrap={false}>
            <View style={[styles.cell, { width: COL.no }]}>
                <Text style={{ fontSize: 8, textAlign: 'center', width: '100%' }}>{index + 1}</Text>
            </View>
            <View style={[styles.cell, { width: COL.name }]}>
                <Line text={machine.name} width={COL.name} base={8} bold />
            </View>
            <View style={[styles.cell, { width: COL.model }]}>
                <Line text={machine.model ?? ''} width={COL.model} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.serial }]}>
                <Line text={machine.serialNumber ?? ''} width={COL.serial} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.maker }]}>
                <Line text={machine.maker ?? ''} width={COL.maker} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.capacity }]}>
                <Line text={machine.capacity ?? ''} width={COL.capacity} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.owner }]}>
                <Line text={machine.ownerName ?? ''} width={COL.owner} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.inspection }]}>
                <Line text={machine.inspectionDate ? isoDateToReiwa(machine.inspectionDate) : ''} width={COL.inspection} base={6} />
            </View>
            <View style={[styles.cell, { width: COL.operator }]}>
                <Line text={machine.operatorName} width={COL.operator} base={7.5} />
            </View>
            <View style={[styles.cell, styles.cellLast, { width: COL.notes }]}>
                <Line text={machine.notes ?? ''} width={COL.notes} base={6} />
            </View>
        </View>
    );
}

export function KikaiTodokePDF({ data }: KikaiTodokePDFProps) {
    const pages = chunkMeiboWorkers(data.machines, TODOKE_ROWS_PER_PAGE);
    return (
        <Document>
            {pages.map((pageMachines, pageIndex) => (
                <Page key={pageIndex} size="A4" orientation="landscape" style={styles.page}>
                    <SafetyDocHeader
                        documentTitle="持込機械等使用届"
                        header={data.header}
                        period={{ from: data.periodFrom, to: data.periodTo }}
                    />
                    <HeaderCells />
                    {pageMachines.map((machine, i) => (
                        <MachineRow key={machine.machineId} machine={machine} index={pageIndex * TODOKE_ROWS_PER_PAGE + i} />
                    ))}
                    <Text style={styles.note}>
                        ※ 持込機械は労働安全衛生法に基づく点検整備を実施済みのものを使用します。
                    </Text>
                    <Text style={styles.pageNumber}>
                        {pageIndex + 1} / {pages.length}
                    </Text>
                </Page>
            ))}
        </Document>
    );
}
