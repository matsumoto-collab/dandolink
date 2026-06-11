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
    type TodokeVehicleSnapshot,
    type VehicleTodokeData,
} from '@/lib/safetyDocuments';

/**
 * 工事・通勤用車両届 PDF（全建統一様式 参考様式第8号 準拠・A4横・押印欄なし）。
 * スナップショット（SafetyDocument.data）のみを入力にとる（FR-4-2）。
 * 1ページ12台で自動改ページ・ヘッダーは各ページに再掲。
 */

export interface VehicleTodokePDFProps {
    data: VehicleTodokeData;
}

// A4 横: 841.89 x 595.28pt。左右 padding 20 → 利用幅 ~800pt。
const COL = {
    no: 24,
    name: 90,       // 車名
    type: 90,       // 車種・型式
    regNumber: 110, // 登録番号
    usage: 50,      // 用途
    inspection: 70, // 車検満了日
    jibaiseki: 110, // 自賠責（会社/期限）
    insurance: 160, // 任意保険（会社・期限/対人・対物・搭乗者）
    driver: 96,     // 運転者
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
        { label: '車名', width: COL.name },
        { label: '車種・型式', width: COL.type },
        { label: '登録番号', width: COL.regNumber },
        { label: '用途', width: COL.usage },
        { label: '車検満了日', width: COL.inspection },
        { label: '自賠責保険\n（会社・満了日）', width: COL.jibaiseki },
        { label: '任意保険\n（会社・満了日／対人・対物・搭乗者）', width: COL.insurance },
        { label: '運転者', width: COL.driver, last: true },
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

function VehicleRow({ vehicle, index }: { vehicle: TodokeVehicleSnapshot; index: number }) {
    const p = vehicle.profile;
    const jibaisekiLine1 = p?.jibaisekiCompany ?? '';
    const jibaisekiLine2 = p?.jibaisekiExpiry ? `〜${isoDateToReiwa(p.jibaisekiExpiry)}` : '';
    const insuranceLine1 = [p?.insuranceCompany ?? '', p?.insuranceExpiry ? `〜${isoDateToReiwa(p.insuranceExpiry)}` : '']
        .filter(Boolean)
        .join('  ');
    const insuranceLine2 = [
        p?.insurancePersonal ? `対人: ${p.insurancePersonal}` : '',
        p?.insuranceObjective ? `対物: ${p.insuranceObjective}` : '',
        p?.insurancePassenger ? `搭乗者: ${p.insurancePassenger}` : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <View style={styles.dataRow} wrap={false}>
            <View style={[styles.cell, { width: COL.no }]}>
                <Text style={{ fontSize: 8, textAlign: 'center', width: '100%' }}>{index + 1}</Text>
            </View>
            <View style={[styles.cell, { width: COL.name }]}>
                <Line text={vehicle.name} width={COL.name} base={8} bold />
            </View>
            <View style={[styles.cell, { width: COL.type }]}>
                <Line text={p?.vehicleType ?? ''} width={COL.type} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.regNumber }]}>
                <Line text={p?.registrationNumber ?? ''} width={COL.regNumber} base={8} />
            </View>
            <View style={[styles.cell, { width: COL.usage }]}>
                <Line text={p?.usage ?? ''} width={COL.usage} base={7} />
            </View>
            <View style={[styles.cell, { width: COL.inspection }]}>
                <Line text={p?.inspectionExpiry ? isoDateToReiwa(p.inspectionExpiry) : ''} width={COL.inspection} base={6.5} />
            </View>
            <View style={[styles.cell, { width: COL.jibaiseki }]}>
                {jibaisekiLine1 ? <Line text={jibaisekiLine1} width={COL.jibaiseki} base={6.5} /> : null}
                {jibaisekiLine2 ? <Line text={jibaisekiLine2} width={COL.jibaiseki} base={6} /> : null}
            </View>
            <View style={[styles.cell, { width: COL.insurance }]}>
                {insuranceLine1 ? <Line text={insuranceLine1} width={COL.insurance} base={6.5} /> : null}
                {insuranceLine2 ? <Line text={insuranceLine2} width={COL.insurance} base={6} /> : null}
            </View>
            <View style={[styles.cell, styles.cellLast, { width: COL.driver }]}>
                <Line text={vehicle.driverName} width={COL.driver} base={7.5} />
            </View>
        </View>
    );
}

export function VehicleTodokePDF({ data }: VehicleTodokePDFProps) {
    const pages = chunkMeiboWorkers(data.vehicles, TODOKE_ROWS_PER_PAGE);
    return (
        <Document>
            {pages.map((pageVehicles, pageIndex) => (
                <Page key={pageIndex} size="A4" orientation="landscape" style={styles.page}>
                    <SafetyDocHeader
                        documentTitle="工事・通勤用車両届"
                        header={data.header}
                        period={{ from: data.periodFrom, to: data.periodTo }}
                    />
                    <HeaderCells />
                    {pageVehicles.map((vehicle, i) => (
                        <VehicleRow key={vehicle.vehicleId} vehicle={vehicle} index={pageIndex * TODOKE_ROWS_PER_PAGE + i} />
                    ))}
                    <Text style={styles.note}>
                        ※ 運転者は有効な運転免許を有し、自動車検査証・保険の内容は提出日時点のものを記載しています。
                    </Text>
                    <Text style={styles.pageNumber}>
                        {pageIndex + 1} / {pages.length}
                    </Text>
                </Page>
            ))}
        </Document>
    );
}
