'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { sanitizePdfText } from './styles';
import { SafetyDocHeader } from './SafetyDocHeader';
import {
    getMachineCategoryLabel,
    isoDateToReiwa,
    type KikaiTodokeData,
    type MachineSnapshot,
} from '@/lib/safetyDocuments';

/**
 * 移動式クレーン・車両系建設機械等使用届 PDF（全建統一様式第9号 準拠・A4縦・1台1葉・押印欄なし）。
 * スナップショット（SafetyDocument.data）のみを入力にとる（FR-4-2）。
 * 機械ごとに1ページを生成し、各ページにヘッダーを再掲する。
 */

export interface CraneTodokePDFProps {
    data: KikaiTodokeData;
}

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 9,
        paddingTop: 24,
        paddingBottom: 24,
        paddingHorizontal: 32,
        backgroundColor: '#ffffff',
    },
    table: {
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: '#000000',
        marginTop: 6,
    },
    row: {
        flexDirection: 'row',
        borderBottomWidth: 0.75,
        borderBottomColor: '#000000',
        minHeight: 26,
    },
    labelCell: {
        width: 150,
        backgroundColor: '#f1f5f9',
        borderRightWidth: 0.75,
        borderRightColor: '#000000',
        justifyContent: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    valueCell: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    labelText: {
        fontSize: 8,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    valueText: {
        fontSize: 9.5,
        color: '#111111',
    },
    note: {
        marginTop: 8,
        fontSize: 7,
        color: '#374151',
        lineHeight: 1.5,
    },
    pageNumber: {
        position: 'absolute',
        bottom: 10,
        right: 32,
        fontSize: 7,
        color: '#374151',
    },
});

function FieldRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.row}>
            <View style={styles.labelCell}>
                <Text style={styles.labelText}>{label}</Text>
            </View>
            <View style={styles.valueCell}>
                <Text style={styles.valueText}>{sanitizePdfText(value || '')}</Text>
            </View>
        </View>
    );
}

function CranePage({ machine, data, pageIndex, pageCount }: {
    machine: MachineSnapshot;
    data: KikaiTodokeData;
    pageIndex: number;
    pageCount: number;
}) {
    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            <SafetyDocHeader
                documentTitle="移動式クレーン等使用届"
                header={data.header}
                period={{ from: data.periodFrom, to: data.periodTo }}
            />

            <View style={styles.table}>
                <FieldRow label="機械名" value={machine.name} />
                <FieldRow label="区分" value={getMachineCategoryLabel(machine.category)} />
                <FieldRow label="型式" value={machine.model ?? ''} />
                <FieldRow label="製造番号" value={machine.serialNumber ?? ''} />
                <FieldRow label="メーカー" value={machine.maker ?? ''} />
                <FieldRow label="能力（吊上荷重等）" value={machine.capacity ?? ''} />
                <FieldRow label="所有会社" value={machine.ownerName ?? ''} />
                <FieldRow label="検査証番号" value={machine.certificateNumber ?? ''} />
                <FieldRow
                    label="検査証有効期限"
                    value={machine.inspectionExpiry ? isoDateToReiwa(machine.inspectionExpiry) : ''}
                />
                <FieldRow
                    label="定期自主検査実施日"
                    value={machine.inspectionDate ? isoDateToReiwa(machine.inspectionDate) : ''}
                />
                <FieldRow label="運転者（オペレーター）" value={machine.operatorName} />
                <FieldRow label="備考" value={machine.notes ?? ''} />
            </View>

            <Text style={styles.note}>
                ※ 運転者は当該機械の運転に必要な免許・技能講習を修了しています（資格の詳細は作業員名簿を参照）。{'\n'}
                ※ 検査証および定期自主検査記録は現場に備え付け、求めに応じて提示します。
            </Text>

            <Text style={styles.pageNumber}>
                {pageIndex + 1} / {pageCount}
            </Text>
        </Page>
    );
}

export function CraneTodokePDF({ data }: CraneTodokePDFProps) {
    const machines = data.machines.length > 0 ? data.machines : [null];
    return (
        <Document>
            {machines.map((machine, i) =>
                machine ? (
                    <CranePage key={machine.machineId} machine={machine} data={data} pageIndex={i} pageCount={machines.length} />
                ) : (
                    // 0台でも枠だけのページを出す（プレビュー用）
                    <Page key="empty" size="A4" orientation="portrait" style={styles.page}>
                        <SafetyDocHeader
                            documentTitle="移動式クレーン等使用届"
                            header={data.header}
                            period={{ from: data.periodFrom, to: data.periodTo }}
                        />
                        <Text style={styles.note}>機械が選択されていません</Text>
                    </Page>
                )
            )}
        </Document>
    );
}
