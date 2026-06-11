'use client';

import React from 'react';
import { View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize, sanitizePdfText } from './styles';
import { isoDateToReiwa, type MeiboHeader } from '@/lib/safetyDocuments';

/**
 * 安全書類PDFの共通ヘッダー（タイトル + 提出日 + 元請/現場/自社情報 + 任意の使用期間）。
 * 作業員名簿・車両届・機械届で共用し、各ページに再掲する。
 */

const styles = StyleSheet.create({
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 4,
    },
    titleSpacer: { width: 180 },
    title: {
        flex: 1,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: 'bold',
        letterSpacing: 4,
    },
    submitDate: {
        width: 180,
        textAlign: 'right',
        fontSize: 7.5,
    },
    infoBand: {
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: '#000000',
        marginBottom: 4,
    },
    infoCellLeft: {
        flex: 1.2,
        borderRightWidth: 0.75,
        borderRightColor: '#000000',
        padding: 3,
    },
    infoCellRight: {
        flex: 1,
        padding: 3,
    },
    infoLine: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        minHeight: 12,
    },
    infoLabel: {
        fontSize: 6,
        color: '#374151',
        width: 64,
    },
});

function Line({ text, width, base, bold }: { text: string; width: number; base: number; bold?: boolean }) {
    return (
        <Text
            style={{
                fontSize: fitCellFontSize(sanitizePdfText(text || ''), width, base, 5),
                fontWeight: bold ? 'bold' : 'normal',
                color: '#111111',
                flex: 1,
            }}
        >
            {text}
        </Text>
    );
}

export interface SafetyDocHeaderProps {
    documentTitle: string;
    header: MeiboHeader;
    /** 使用期間（車両届・機械届） */
    period?: { from: string | null; to: string | null };
}

export function SafetyDocHeader({ documentTitle, header, period }: SafetyDocHeaderProps) {
    const periodText =
        period && (period.from || period.to)
            ? `${period.from ? isoDateToReiwa(period.from) : ''} 〜 ${period.to ? isoDateToReiwa(period.to) : ''}`
            : '';

    return (
        <View>
            <View style={styles.titleRow}>
                <View style={styles.titleSpacer} />
                <Text style={styles.title}>{documentTitle}</Text>
                <Text style={styles.submitDate}>
                    {header.submitDate ? `提出日: ${isoDateToReiwa(header.submitDate)}` : ''}
                </Text>
            </View>

            <View style={styles.infoBand}>
                <View style={styles.infoCellLeft}>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>事業所の名称</Text>
                        <Line text={header.siteName} width={300} base={8} bold />
                    </View>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>元請会社名</Text>
                        <Line text={header.primeContractor} width={300} base={8} />
                    </View>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>所長名</Text>
                        <Line text={header.primeSiteManager} width={300} base={8} />
                    </View>
                </View>
                <View style={styles.infoCellRight}>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>会社名</Text>
                        <Line
                            text={`${header.companyName}${header.tier ? `（${header.tier}）` : ''}`}
                            width={250}
                            base={8}
                            bold
                        />
                    </View>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>代表者名</Text>
                        <Line text={header.companyRepresentative} width={250} base={8} />
                    </View>
                    <View style={styles.infoLine}>
                        <Text style={styles.infoLabel}>所在地</Text>
                        <Line text={header.companyAddress} width={250} base={7} />
                    </View>
                    {periodText ? (
                        <View style={styles.infoLine}>
                            <Text style={styles.infoLabel}>使用期間</Text>
                            <Line text={periodText} width={250} base={7.5} />
                        </View>
                    ) : null}
                </View>
            </View>
        </View>
    );
}
