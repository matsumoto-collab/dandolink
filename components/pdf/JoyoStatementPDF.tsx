'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { FitText } from './FitText';
import { wrapTextToWidth } from './styles';
import { AttendanceMonthlyPage, type AttendanceMonthlyPDFProps } from './AttendanceMonthlyPDF';
import { formatQuantity, periodLabel, toReiwaYmd, JOYO_LIMITS, JOYO_TAX_PERCENT } from '@/lib/joyoStatement';

/** 明細1行（金額は呼び出し側で計算済みの値を渡す） */
export interface JoyoStatementPdfItem {
    name: string;
    quantity: number | null;
    unit: string;
    unitPrice: number | null;
    amount: number;
    note: string;
}

/** 宛先（常用で来ている一人親方） */
export interface JoyoStatementPdfRecipient {
    name: string;
    honorific: string;
    postalCode: string | null;
    address: string | null;
    /** インボイスの登録番号（T＋13桁）。無ければ出さない */
    registrationNumber: string | null;
}

/** 発行者（自社情報） */
export interface JoyoStatementPdfIssuer {
    name: string;
    postalCode: string;
    address: string;
    tel: string;
    fax: string | null;
    registrationNumber: string | null;
}

export interface JoyoStatementPDFProps {
    /** 見出し（設定の「書類の名前」。既定: 支払明細書） */
    title: string;
    /** 書類番号。発行済みのときだけ渡す。null なら「No.」を出さない（下書き・発行を取り消した下書きのプレビュー） */
    statementNo: string | null;
    /** 発行日 'YYYY-MM-DD' */
    issueDate: string;
    /** 支払日 'YYYY-MM-DD' */
    paymentDate: string;
    /** 対象月（作業した月） */
    year: number;
    month: number;
    /** 件名 */
    subject: string;
    recipient: JoyoStatementPdfRecipient;
    issuer: JoyoStatementPdfIssuer;
    items: JoyoStatementPdfItem[];
    /** 合計（税込） */
    total: number;
    /** 内消費税等 */
    tax: number;
    /** 表の下に出す注意書き（設定。空なら出さない） */
    footerNote: string | null;
    /** 2ページ目に付ける出勤簿。null なら付けない */
    attendance: AttendanceMonthlyPDFProps | null;
}

const COLOR = {
    border: '#000000',
    grid: '#8c8c8c',
    band: '#d9d9d9',
    zebra: '#f0f0f0',
    text: '#000000',
    sub: '#333333',
} as const;

// A4縦: 595pt − 左右padding 36pt×2 = 523pt
const CONTENT_WIDTH = 523;
const COL = {
    quantity: 44,
    unit: 34,
    unitPrice: 66,
    amount: 80,
    note: 112,
} as const;
const COL_NAME = CONTENT_WIDTH - COL.quantity - COL.unit - COL.unitPrice - COL.amount - COL.note; // 187

/**
 * 明細の行数。入力の上限（JOYO_LIMITS.maxItems）と同じ数で固定し、足りないぶんは空行で埋める。
 * 行の高さ・備考の行数・注意書きの行数・住所の行数も上限を決めてあるので、1ページ目の高さは内容で変わらない
 * （上限いっぱいでも1ページに収まることを描画して確認済み。数字を変えたら描き直して確かめること）。
 */
const ROWS = JOYO_LIMITS.maxItems;
const ROW_HEIGHT = 22;
const NOTE_FONT_SIZE = 7.5;
const NOTE_MAX_LINES = 2;
const FOOTER_FONT_SIZE = 8.5;
const ADDRESS_MAX_LINES = 3;
const RIGHT_BOX_WIDTH = 240;
const RECIPIENT_BOX_WIDTH = 250;

const yen = (n: number): string => (n < 0 ? `-¥${Math.abs(n).toLocaleString('ja-JP')}` : `¥${n.toLocaleString('ja-JP')}`);
const num = (n: number | null): string => (n == null || !Number.isFinite(n) ? '' : n.toLocaleString('ja-JP'));

/** 幅で折り返し、maxLines を超えたぶんは末尾を … にして切る（行の高さを変えないため） */
function wrapAndClamp(text: string, contentWidth: number, fontSize: number, maxLines: number): string {
    if (!text) return '';
    const lines = wrapTextToWidth(text, contentWidth, fontSize).split('\n');
    if (lines.length <= maxLines) return lines.join('\n');
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, -1)}…`;
    return kept.join('\n');
}

/** 「〒」「TEL:」「FAX:」が値の頭に入っていても二重に出さない（自社情報や設定に記号ごと入力された場合の保険） */
const stripPostalMark = (v: string): string => v.replace(/^[〒\s]+/, '');
const stripPhoneLabel = (v: string): string => v.replace(/^(?:TEL|FAX|ＴＥＬ|ＦＡＸ|電話)[\s:：.]*/i, '');

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        paddingTop: 40,
        paddingBottom: 36,
        paddingHorizontal: 36,
        backgroundColor: '#ffffff',
        color: COLOR.text,
    },
    top: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    recipientBox: {
        width: RECIPIENT_BOX_WIDTH,
        paddingTop: 6,
    },
    recipientAddr: { fontSize: 10, lineHeight: 1.45 },
    recipientName: { fontSize: 16, fontWeight: 'bold', marginTop: 16 },
    recipientReg: { fontSize: 9, marginTop: 6, color: COLOR.sub },
    rightBox: { width: RIGHT_BOX_WIDTH },
    titleBand: {
        backgroundColor: COLOR.band,
        paddingVertical: 4,
        paddingHorizontal: 8,
    },
    titleText: { fontSize: 15, fontWeight: 'bold' },
    titleMeta: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottomWidth: 0.75,
        borderBottomColor: COLOR.border,
        paddingVertical: 3,
        paddingHorizontal: 2,
    },
    metaText: { fontSize: 9 },
    issuerName: { fontSize: 13, fontWeight: 'bold', marginTop: 14, marginBottom: 3 },
    issuerText: { fontSize: 9, lineHeight: 1.45 },

    subjectRow: {
        flexDirection: 'row',
        marginTop: 20,
        width: 330,
        borderBottomWidth: 0.75,
        borderBottomColor: COLOR.border,
        paddingBottom: 2,
    },
    subjectLabel: { fontSize: 10, width: 50 },
    subjectValue: { fontSize: 10, flex: 1 },
    periodText: { fontSize: 9, marginTop: 4, color: COLOR.sub },

    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'stretch',
        marginTop: 10,
    },
    totalBox: {
        width: 316,
        borderWidth: 1,
        borderColor: COLOR.border,
        flexDirection: 'row',
    },
    totalCol: { flex: 1, borderRightWidth: 0.75, borderRightColor: COLOR.border },
    taxCol: { width: 104 },
    boxLabel: {
        backgroundColor: COLOR.band,
        borderBottomWidth: 0.75,
        borderBottomColor: COLOR.border,
        paddingVertical: 2,
    },
    boxLabelText: { fontSize: 9, textAlign: 'center' },
    totalValueCell: { height: 34, justifyContent: 'center', alignItems: 'center' },
    totalValueText: { fontSize: 18, fontWeight: 'bold' },
    taxValueText: { fontSize: 11, fontWeight: 'bold' },
    payBox: {
        width: 199,
        borderWidth: 1,
        borderColor: COLOR.border,
        flexDirection: 'row',
    },
    payLabelCell: {
        width: 50,
        backgroundColor: COLOR.band,
        borderRightWidth: 0.75,
        borderRightColor: COLOR.border,
        justifyContent: 'center',
    },
    payValueCell: { flex: 1, justifyContent: 'center', paddingHorizontal: 6 },
    payValueText: { fontSize: 11 },

    table: {
        marginTop: 8,
        borderWidth: 1,
        borderColor: COLOR.border,
    },
    headerRow: {
        flexDirection: 'row',
        backgroundColor: COLOR.band,
        borderBottomWidth: 1,
        borderBottomColor: COLOR.border,
        minHeight: 18,
    },
    dataRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: COLOR.grid,
        minHeight: ROW_HEIGHT,
    },
    totalRow: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: COLOR.border,
        minHeight: ROW_HEIGHT,
    },
    cell: {
        paddingHorizontal: 4,
        // 0.5〜0.75pt だと低解像度の表示（スマホの一覧表示など）で線が抜けることがあるので 1pt にする
        borderRightWidth: 1,
        borderRightColor: COLOR.grid,
        justifyContent: 'center',
    },
    cellLast: { paddingHorizontal: 4, justifyContent: 'center' },
    headerText: { fontSize: 9, textAlign: 'center' },
    nameText: { fontSize: 10.5 },
    centerText: { fontSize: 10, textAlign: 'center' },
    rightText: { fontSize: 10, textAlign: 'right' },
    noteText: { fontSize: NOTE_FONT_SIZE },
    totalLabelText: { fontSize: 10, textAlign: 'center' },
    totalAmountText: { fontSize: 11, fontWeight: 'bold', textAlign: 'right' },

    taxLine: { fontSize: 9, textAlign: 'right', marginTop: 5 },
    footerNote: { fontSize: FOOTER_FONT_SIZE, marginTop: 8, lineHeight: 1.5, color: COLOR.sub },
});

/** 明細ページ（1人ぶん） */
export function JoyoStatementPage({
    title,
    statementNo,
    issueDate,
    paymentDate,
    year,
    month,
    subject,
    recipient,
    issuer,
    items,
    total,
    tax,
    footerNote,
}: Omit<JoyoStatementPDFProps, 'attendance'>) {
    // 行数は ROWS で固定（足りないぶんは空行）。上限を超えて渡されたら、その数だけ出す（次のページへ続く）
    const blankCount = Math.max(0, ROWS - items.length);
    const rows: (JoyoStatementPdfItem | null)[] = [...items, ...Array<null>(blankCount).fill(null)];
    const footer = footerNote
        ? wrapAndClamp(footerNote, CONTENT_WIDTH, FOOTER_FONT_SIZE, JOYO_LIMITS.footerLines)
        : '';

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            <View style={styles.top}>
                {/* 左: 宛先 */}
                <View style={styles.recipientBox}>
                    {recipient.postalCode ? (
                        <Text style={styles.recipientAddr}>〒{stripPostalMark(recipient.postalCode)}</Text>
                    ) : null}
                    {recipient.address ? (
                        <Text style={styles.recipientAddr}>
                            {wrapAndClamp(recipient.address, RECIPIENT_BOX_WIDTH, 10, ADDRESS_MAX_LINES)}
                        </Text>
                    ) : null}
                    <FitText width={RECIPIENT_BOX_WIDTH} base={16} minFontSize={8} style={styles.recipientName}>
                        {`${recipient.name}　${recipient.honorific}`}
                    </FitText>
                    {recipient.registrationNumber ? (
                        <Text style={styles.recipientReg}>登録番号 {recipient.registrationNumber}</Text>
                    ) : null}
                </View>

                {/* 右: 見出し・日付・発行者 */}
                <View style={styles.rightBox}>
                    <View style={styles.titleBand}>
                        {/* 短い見出しだけ字間を空ける（長い見出しは FitText の幅の見積もりが狂うので空けない） */}
                        <FitText
                            width={RIGHT_BOX_WIDTH - 16 - (title.length <= 10 ? title.length * 2 : 0)}
                            base={15}
                            minFontSize={9}
                            style={title.length <= 10 ? [styles.titleText, { letterSpacing: 2 }] : styles.titleText}
                        >
                            {title}
                        </FitText>
                    </View>
                    <View style={styles.titleMeta}>
                        <Text style={styles.metaText}>{toReiwaYmd(issueDate)}</Text>
                        <Text style={styles.metaText}>{statementNo ? `No. ${statementNo}` : ''}</Text>
                    </View>
                    <FitText width={RIGHT_BOX_WIDTH} base={13} minFontSize={8} style={styles.issuerName}>
                        {issuer.name}
                    </FitText>
                    <Text style={styles.issuerText}>〒{stripPostalMark(issuer.postalCode)}</Text>
                    <Text style={styles.issuerText}>{wrapAndClamp(issuer.address, RIGHT_BOX_WIDTH, 9, 2)}</Text>
                    <Text style={styles.issuerText}>
                        TEL {stripPhoneLabel(issuer.tel)}
                        {issuer.fax ? `　FAX ${stripPhoneLabel(issuer.fax)}` : ''}
                    </Text>
                    {issuer.registrationNumber ? (
                        <Text style={styles.issuerText}>登録番号 {issuer.registrationNumber}</Text>
                    ) : null}
                </View>
            </View>

            {/* 件名・対象期間 */}
            <View style={styles.subjectRow}>
                <Text style={styles.subjectLabel}>件名：</Text>
                <FitText width={276} base={10} minFontSize={7.5} style={styles.subjectValue}>
                    {subject}
                </FitText>
            </View>
            <Text style={styles.periodText}>対象期間：{periodLabel(year, month)}</Text>

            {/* 合計金額・内消費税等 / 支払日 */}
            <View style={styles.summaryRow}>
                <View style={styles.totalBox}>
                    <View style={styles.totalCol}>
                        <View style={styles.boxLabel}>
                            <Text style={styles.boxLabelText}>合計金額（税込）</Text>
                        </View>
                        <View style={styles.totalValueCell}>
                            <Text style={styles.totalValueText}>{yen(total)}</Text>
                        </View>
                    </View>
                    <View style={styles.taxCol}>
                        <View style={styles.boxLabel}>
                            <Text style={styles.boxLabelText}>内消費税等</Text>
                        </View>
                        <View style={styles.totalValueCell}>
                            <Text style={styles.taxValueText}>{yen(tax)}</Text>
                        </View>
                    </View>
                </View>
                <View style={styles.payBox}>
                    <View style={styles.payLabelCell}>
                        <Text style={styles.boxLabelText}>支払日</Text>
                    </View>
                    <View style={styles.payValueCell}>
                        <Text style={styles.payValueText}>{toReiwaYmd(paymentDate)}</Text>
                    </View>
                </View>
            </View>

            {/* 明細 */}
            <View style={styles.table}>
                <View style={styles.headerRow}>
                    <View style={[styles.cell, { width: COL_NAME }]}>
                        <Text style={styles.headerText}>品名</Text>
                    </View>
                    <View style={[styles.cell, { width: COL.quantity }]}>
                        <Text style={styles.headerText}>数量</Text>
                    </View>
                    <View style={[styles.cell, { width: COL.unit }]}>
                        <Text style={styles.headerText}>単位</Text>
                    </View>
                    <View style={[styles.cell, { width: COL.unitPrice }]}>
                        <Text style={styles.headerText}>単価</Text>
                    </View>
                    <View style={[styles.cell, { width: COL.amount }]}>
                        <Text style={styles.headerText}>金額</Text>
                    </View>
                    <View style={[styles.cellLast, { width: COL.note }]}>
                        <Text style={styles.headerText}>備考</Text>
                    </View>
                </View>

                {rows.map((item, i) => (
                    <View
                        key={i}
                        style={[styles.dataRow, i % 2 === 1 ? { backgroundColor: COLOR.zebra } : {}]}
                        wrap={false}
                    >
                        <View style={[styles.cell, { width: COL_NAME }]}>
                            <FitText width={COL_NAME - 9} base={10.5} minFontSize={7} style={styles.nameText}>
                                {item?.name ?? ''}
                            </FitText>
                        </View>
                        <View style={[styles.cell, { width: COL.quantity }]}>
                            <FitText width={COL.quantity - 9} base={10} minFontSize={7} style={styles.centerText}>
                                {item && item.quantity != null ? formatQuantity(item.quantity) : ''}
                            </FitText>
                        </View>
                        <View style={[styles.cell, { width: COL.unit }]}>
                            <FitText width={COL.unit - 9} base={10} minFontSize={6} style={styles.centerText}>
                                {item?.unit ?? ''}
                            </FitText>
                        </View>
                        <View style={[styles.cell, { width: COL.unitPrice }]}>
                            <FitText width={COL.unitPrice - 9} base={10} minFontSize={7} style={styles.rightText}>
                                {item ? num(item.unitPrice) : ''}
                            </FitText>
                        </View>
                        <View style={[styles.cell, { width: COL.amount }]}>
                            <FitText width={COL.amount - 9} base={10} minFontSize={7} style={styles.rightText}>
                                {item ? num(item.amount) : ''}
                            </FitText>
                        </View>
                        <View style={[styles.cellLast, { width: COL.note }]}>
                            <Text style={styles.noteText}>
                                {item?.note ? wrapAndClamp(item.note, COL.note - 9, NOTE_FONT_SIZE, NOTE_MAX_LINES) : ''}
                            </Text>
                        </View>
                    </View>
                ))}

                <View style={styles.totalRow} wrap={false}>
                    <View style={[styles.cell, { width: COL_NAME + COL.quantity + COL.unit }]} />
                    <View style={[styles.cell, { width: COL.unitPrice }]}>
                        <Text style={styles.totalLabelText}>合計</Text>
                    </View>
                    <View style={[styles.cell, { width: COL.amount }]}>
                        <FitText width={COL.amount - 9} base={11} minFontSize={7} style={styles.totalAmountText}>
                            {num(total)}
                        </FitText>
                    </View>
                    <View style={[styles.cellLast, { width: COL.note }]} />
                </View>
            </View>

            {/* 税の内訳と注意書きは、ばらばらに次のページへ送られないよう1かたまりにする */}
            <View wrap={false}>
                <Text style={styles.taxLine}>
                    {JOYO_TAX_PERCENT}%対象 {yen(total)}（内消費税等 {yen(tax)}）
                </Text>
                {/* 日本語の途中に「-」が入らないよう、幅で先に折り返してから渡す */}
                {footer ? <Text style={styles.footerNote}>{footer}</Text> : null}
            </View>
        </Page>
    );
}

/** 支払明細書（1ページ目＝明細、2ページ目＝出勤簿） */
export function JoyoStatementPDF({ attendance, ...statement }: JoyoStatementPDFProps) {
    return (
        <Document title={`${statement.title} ${statement.recipient.name}`} author={statement.issuer.name}>
            <JoyoStatementPage {...statement} />
            {attendance ? <AttendanceMonthlyPage {...attendance} /> : null}
        </Document>
    );
}

export default JoyoStatementPDF;
