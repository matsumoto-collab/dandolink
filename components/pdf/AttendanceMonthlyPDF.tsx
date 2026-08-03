'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { wrapTextToWidth } from './styles';

/** 区分セルの塗り分け種別（紙の出勤簿に合わせる） */
export type AttendanceCellKind = 'normal' | 'holiday' | 'paidLeave';

/** 1日分の行データ（分→"H:MM" などの整形は utils 側で済ませて渡す） */
export interface AttendanceMonthlyPdfDay {
    /** 日番号（1〜月末） */
    day: number;
    /** 0=日 〜 6=土 */
    dow: number;
    /** 曜日ラベル（日〜土） */
    weekday: string;
    /** 区分ラベル（出勤/休日/有給 など。未登録の平日は空） */
    statusLabel: string;
    /** 区分セルの塗り */
    kind: AttendanceCellKind;
    earlyStart: string;
    morningLoading: string;
    startTime: string;
    endTime: string;
    overtime: string;
    eveningLoading: string;
    breakTime: string;
    actual: string;
    diff: string;
    note: string;
}

/** 合計時間行（表最下部） */
export interface AttendanceMonthlyPdfTotals {
    earlyStart: string;
    morningLoading: string;
    overtime: string;
    eveningLoading: string;
    diff: string;
}

/** 表の下に置く集計ボックス群 */
export interface AttendanceMonthlyPdfSummary {
    presentDays: number;
    absentDays: number;
    paidLeaveDays: number;
    morningLoading: string;
    eveningLoading: string;
    earlyStartOvertime: string;
    /** 時間外合計 = 朝積 + 早出 + 残業 + 夕積 */
    overtimeTotal: string;
    earlyEnd: string;
    grandTotal: string;
}

export interface AttendanceMonthlyPDFProps {
    year: number;
    month: number;
    userName: string;
    days: AttendanceMonthlyPdfDay[];
    totals: AttendanceMonthlyPdfTotals;
    summary: AttendanceMonthlyPdfSummary;
    /** ヘッダー右の所定労働時間表記（既定: 所定労働時間1日7ｈ） */
    standardWorkLabel?: string;
}

// 紙（Excel由来）の配色
const COLOR = {
    headerBg: '#B8CCE4',
    holidayBg: '#FBD5B5',
    saturdayBg: '#DCE6F1',
    paidLeaveBg: '#4CAF50',
    paidLeaveText: '#ffffff',
    summaryLabelBg: '#C5CBE3',
    border: '#000000',
    gridLine: '#808080',
    sunday: '#FF0000',
    saturday: '#0070C0',
    text: '#000000',
} as const;

// A4縦: 595pt − 左右padding 28pt×2 = 539pt
// 時刻列は "10:00" が入れば足りるため紙より詰め、余りを備考に回している（実データの備考が長いため）。
const COL = {
    day: 28,
    weekday: 24,
    status: 44,
    earlyStart: 34,
    morningLoading: 34,
    start: 44,
    end: 44,
    overtime: 34,
    eveningLoading: 34,
    break: 40,
    actual: 40,
    diff: 40,
    note: 99,
} as const;

const ROW_HEIGHT = 18;

const NOTE_FONT_SIZE = 6;
/** 行高を保つため備考は最大3行まで（超過分は末尾を … で省略） */
const NOTE_MAX_LINES = 3;

/** 備考を備考列の内寸で折り返し、3行を超えたら省略する */
function formatNote(note: string): string {
    if (!note) return '';
    const wrapped = wrapTextToWidth(note, COL.note - 4, NOTE_FONT_SIZE);
    const lines = wrapped.split('\n');
    if (lines.length <= NOTE_MAX_LINES) return wrapped;
    const kept = lines.slice(0, NOTE_MAX_LINES);
    kept[NOTE_MAX_LINES - 1] = `${kept[NOTE_MAX_LINES - 1].slice(0, -1)}…`;
    return kept.join('\n');
}

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        paddingTop: 26,
        paddingBottom: 24,
        paddingHorizontal: 28,
        backgroundColor: '#ffffff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    docTitle: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    nameBox: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderWidth: 1,
        borderColor: COLOR.border,
        minHeight: 22,
    },
    nameLabelCell: {
        width: 46,
        borderRightWidth: 1,
        borderRightColor: COLOR.border,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 3,
    },
    nameValueCell: {
        width: 110,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    standardCell: {
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    nameLabelText: { fontSize: 9 },
    nameValueText: { fontSize: 11, fontWeight: 'bold' },
    standardText: { fontSize: 9 },

    table: {
        borderWidth: 1,
        borderColor: COLOR.border,
    },
    headerRow: {
        flexDirection: 'row',
        backgroundColor: COLOR.headerBg,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.border,
        minHeight: 16,
    },
    dataRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLOR.gridLine,
        minHeight: ROW_HEIGHT,
    },
    totalRow: {
        flexDirection: 'row',
        backgroundColor: COLOR.headerBg,
        borderTopWidth: 1,
        borderTopColor: COLOR.border,
        minHeight: ROW_HEIGHT,
    },
    cell: {
        paddingHorizontal: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLOR.gridLine,
        justifyContent: 'center',
    },
    cellLast: {
        paddingHorizontal: 2,
        justifyContent: 'center',
    },
    headerText: {
        fontSize: 8,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    cellText: {
        fontSize: 8,
        textAlign: 'center',
    },
    noteText: {
        fontSize: NOTE_FONT_SIZE,
        textAlign: 'left',
    },
    totalLabel: {
        fontSize: 8.5,
        fontWeight: 'bold',
        textAlign: 'center',
    },

    summaryWrap: {
        marginTop: 12,
        alignSelf: 'flex-end',
        borderWidth: 1,
        borderColor: COLOR.border,
    },
    summaryRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLOR.gridLine,
        minHeight: 17,
    },
    summaryRowLast: {
        flexDirection: 'row',
        minHeight: 17,
    },
    summaryLabelCell: {
        width: 62,
        backgroundColor: COLOR.summaryLabelBg,
        borderRightWidth: 0.5,
        borderRightColor: COLOR.gridLine,
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    summaryValueCell: {
        width: 66,
        borderRightWidth: 0.5,
        borderRightColor: COLOR.gridLine,
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    summaryValueCellLast: {
        width: 66,
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    summaryLabelText: { fontSize: 8 },
    summaryValueText: { fontSize: 8, textAlign: 'right' },
});

/** 日付・曜日セルの背景（休日のみ塗る＝紙の出勤簿と同じ） */
function dateCellBg(day: AttendanceMonthlyPdfDay): string | undefined {
    if (day.kind !== 'holiday') return undefined;
    if (day.dow === 0) return COLOR.holidayBg;
    if (day.dow === 6) return COLOR.saturdayBg;
    return COLOR.holidayBg;
}

/** 日付・曜日セルの文字色（土=青 / 日=赤） */
function dateCellColor(dow: number): string {
    if (dow === 0) return COLOR.sunday;
    if (dow === 6) return COLOR.saturday;
    return COLOR.text;
}

function statusCellStyle(kind: AttendanceCellKind): { bg?: string; color: string; bold: boolean } {
    if (kind === 'holiday') return { bg: COLOR.holidayBg, color: COLOR.text, bold: false };
    if (kind === 'paidLeave') return { bg: COLOR.paidLeaveBg, color: COLOR.paidLeaveText, bold: true };
    return { color: COLOR.text, bold: false };
}

const HEADER_CELLS: { label: string; width: number }[] = [
    { label: '早出', width: COL.earlyStart },
    { label: '朝積', width: COL.morningLoading },
    { label: '現場開始', width: COL.start },
    { label: '現場終了', width: COL.end },
    { label: '残業', width: COL.overtime },
    { label: '夕積', width: COL.eveningLoading },
    { label: '休憩', width: COL.break },
    { label: '実働', width: COL.actual },
    { label: '差時間', width: COL.diff },
];

export function AttendanceMonthlyPDF({
    year,
    month,
    userName,
    days,
    totals,
    summary,
    standardWorkLabel = '所定労働時間1日7ｈ',
}: AttendanceMonthlyPDFProps) {
    return (
        <Document>
            <Page size="A4" orientation="portrait" style={styles.page}>
                {/* ヘッダー: 左=タイトル / 右=氏名＋所定労働時間の枠 */}
                <View style={styles.header}>
                    <Text style={styles.docTitle}>
                        {year} 年　{month} 月　出勤簿
                    </Text>
                    <View style={styles.nameBox}>
                        <View style={styles.nameLabelCell}>
                            <Text style={styles.nameLabelText}>氏名</Text>
                        </View>
                        <View style={styles.nameValueCell}>
                            <Text style={styles.nameValueText}>{userName}</Text>
                        </View>
                        <View style={styles.standardCell}>
                            <Text style={styles.standardText}>{standardWorkLabel}</Text>
                        </View>
                    </View>
                </View>

                {/* 本体テーブル */}
                <View style={styles.table}>
                    <View style={styles.headerRow}>
                        {/* 「日付」は日番号＋曜日の2列ぶん */}
                        <View style={[styles.cell, { width: COL.day + COL.weekday }]}>
                            <Text style={styles.headerText}>日付</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.status }]}>
                            <Text style={styles.headerText}>区分</Text>
                        </View>
                        {HEADER_CELLS.map((h) => (
                            <View key={h.label} style={[styles.cell, { width: h.width }]}>
                                <Text style={styles.headerText}>{h.label}</Text>
                            </View>
                        ))}
                        <View style={[styles.cellLast, { width: COL.note }]}>
                            <Text style={styles.headerText}>備考</Text>
                        </View>
                    </View>

                    {days.map((d) => {
                        const bg = dateCellBg(d);
                        const dateColor = dateCellColor(d.dow);
                        const st = statusCellStyle(d.kind);
                        return (
                            <View key={d.day} style={styles.dataRow} wrap={false}>
                                <View style={[styles.cell, { width: COL.day, backgroundColor: bg }]}>
                                    <Text style={[styles.cellText, { color: dateColor }]}>{d.day}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.weekday, backgroundColor: bg }]}>
                                    <Text style={[styles.cellText, { color: dateColor }]}>{d.weekday}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.status, backgroundColor: st.bg }]}>
                                    <Text
                                        style={[
                                            styles.cellText,
                                            { color: st.color },
                                            st.bold ? { fontWeight: 'bold' } : {},
                                        ]}
                                    >
                                        {d.statusLabel}
                                    </Text>
                                </View>
                                <View style={[styles.cell, { width: COL.earlyStart }]}>
                                    <Text style={styles.cellText}>{d.earlyStart}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.morningLoading }]}>
                                    <Text style={styles.cellText}>{d.morningLoading}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.start }]}>
                                    <Text style={styles.cellText}>{d.startTime}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.end }]}>
                                    <Text style={styles.cellText}>{d.endTime}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.overtime }]}>
                                    <Text style={styles.cellText}>{d.overtime}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.eveningLoading }]}>
                                    <Text style={styles.cellText}>{d.eveningLoading}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.break }]}>
                                    <Text style={styles.cellText}>{d.breakTime}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.actual }]}>
                                    <Text style={styles.cellText}>{d.actual}</Text>
                                </View>
                                <View style={[styles.cell, { width: COL.diff }]}>
                                    <Text style={styles.cellText}>{d.diff}</Text>
                                </View>
                                <View style={[styles.cellLast, { width: COL.note }]}>
                                    <Text style={styles.noteText}>{formatNote(d.note)}</Text>
                                </View>
                            </View>
                        );
                    })}

                    {/* 合計時間行（日付〜区分を結合したラベル） */}
                    <View style={styles.totalRow} wrap={false}>
                        <View style={[styles.cell, { width: COL.day + COL.weekday + COL.status }]}>
                            <Text style={styles.totalLabel}>合計時間</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.earlyStart }]}>
                            <Text style={styles.cellText}>{totals.earlyStart}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.morningLoading }]}>
                            <Text style={styles.cellText}>{totals.morningLoading}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.start }]}>
                            <Text style={styles.cellText}> </Text>
                        </View>
                        <View style={[styles.cell, { width: COL.end }]}>
                            <Text style={styles.cellText}> </Text>
                        </View>
                        <View style={[styles.cell, { width: COL.overtime }]}>
                            <Text style={styles.cellText}>{totals.overtime}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.eveningLoading }]}>
                            <Text style={styles.cellText}>{totals.eveningLoading}</Text>
                        </View>
                        <View style={[styles.cell, { width: COL.break }]}>
                            <Text style={styles.cellText}> </Text>
                        </View>
                        <View style={[styles.cell, { width: COL.actual }]}>
                            <Text style={styles.cellText}> </Text>
                        </View>
                        <View style={[styles.cell, { width: COL.diff }]}>
                            <Text style={styles.cellText}>{totals.diff}</Text>
                        </View>
                        <View style={[styles.cellLast, { width: COL.note }]}>
                            <Text style={styles.cellText}> </Text>
                        </View>
                    </View>
                </View>

                {/* 下部サマリー（3行×3ボックス） */}
                <View style={styles.summaryWrap}>
                    <View style={styles.summaryRow}>
                        <SummaryPair label="出勤" value={`${summary.presentDays}`} />
                        <SummaryPair label="朝積" value={summary.morningLoading} />
                        <SummaryPair label="時間外合計" value={summary.overtimeTotal} last />
                    </View>
                    <View style={styles.summaryRow}>
                        <SummaryPair label="欠勤" value={`${summary.absentDays}`} />
                        <SummaryPair label="早出/残業" value={summary.earlyStartOvertime} />
                        <SummaryPair label="早終" value={summary.earlyEnd} last />
                    </View>
                    <View style={styles.summaryRowLast}>
                        <SummaryPair label="有給" value={`${summary.paidLeaveDays}`} />
                        <SummaryPair label="夕積" value={summary.eveningLoading} />
                        <SummaryPair label="合計" value={summary.grandTotal} last />
                    </View>
                </View>
            </Page>
        </Document>
    );
}

function SummaryPair({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <>
            <View style={styles.summaryLabelCell}>
                <Text style={styles.summaryLabelText}>{label}</Text>
            </View>
            <View style={last ? styles.summaryValueCellLast : styles.summaryValueCell}>
                <Text style={styles.summaryValueText}>{value}</Text>
            </View>
        </>
    );
}

export default AttendanceMonthlyPDF;
