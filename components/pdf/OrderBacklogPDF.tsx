'use client';

/**
 * 受注明細書（信用保証協会様式）の PDF。
 *
 * 提出済みシート（A3横・縮小61%）と同じ見た目になるよう、列幅は Excel の列幅比を
 * そのまま A3 横の印字幅へ按分している（B 3.5 / C 14.5 / D 27.5 / E 24.83 / F 23.83 /
 * G〜J 18.5×4 / K〜S 14.5×9）。1案件＝2段・1ページ26枠で、行の高さも Excel の 20.1pt を
 * 61% で刷ったときとほぼ同じ密度になるように決めてある。
 *
 * 描画するデータは Excel 出力とまったく同じ `buildOrderBacklogSheet` の戻り値
 * （lib/orderBacklog/render.ts）。二重実装にしないことで提出物どうしの数字がズレない。
 */
import React from 'react';
import { Document, Page, StyleSheet, View } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize } from '@/components/pdf/styles';
import { ROWS_PER_PAGE } from '@/lib/orderBacklog/types';
import type { MonthColumn, OrderBacklogSheet, RenderRow } from '@/lib/orderBacklog/render';

// フォント登録（NotoSansJP）の副作用を取り込む
import '@/components/pdf/styles';

// ---------------------------------------------------------------- 寸法

/** A3 横（pt）。react-pdf の size="A3" orientation="landscape" と同じ値 */
const PAGE_WIDTH = 1190.55;
const PAGE_PADDING_X = 18;
const PAGE_PADDING_TOP = 14;
const PAGE_PADDING_BOTTOM = 12;
/** 印字幅（この中に B〜S の全列を収める） */
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_PADDING_X * 2;

/** 提出済みシートの列幅（Excel の表示値）。合計 298.66 */
const EXCEL_COL_WIDTHS = {
    /** B 符号 */
    code: 3.5,
    /** C+D 契約先・工事名（様式では C:D を結合して使う） */
    name: 14.5 + 27.5,
    /** E 契約額 */
    contract: 24.83,
    /** F 工事着工日・完成予定日 */
    term: 23.83,
    /** G 出来高％ */
    rate: 18.5,
    /** H 出来高金額 */
    progress: 18.5,
    /** I 既受領金額 */
    received: 18.5,
    /** J 未受領金額 */
    unreceived: 18.5,
    /** K〜S 入金予定（9列） */
    month: 14.5,
} as const;

const EXCEL_TOTAL_WIDTH =
    EXCEL_COL_WIDTHS.code +
    EXCEL_COL_WIDTHS.name +
    EXCEL_COL_WIDTHS.contract +
    EXCEL_COL_WIDTHS.term +
    EXCEL_COL_WIDTHS.rate +
    EXCEL_COL_WIDTHS.progress +
    EXCEL_COL_WIDTHS.received +
    EXCEL_COL_WIDTHS.unreceived +
    EXCEL_COL_WIDTHS.month * 9;

/** Excel の列幅1単位あたりの pt。切り捨てで丸めて合計が印字幅を超えないようにする */
const UNIT = CONTENT_WIDTH / EXCEL_TOTAL_WIDTH;
const toPt = (excelWidth: number): number => Math.floor(excelWidth * UNIT * 100) / 100;

/** 列幅（pt）。合計は CONTENT_WIDTH 以下 */
export const COL = {
    code: toPt(EXCEL_COL_WIDTHS.code),
    name: toPt(EXCEL_COL_WIDTHS.name),
    contract: toPt(EXCEL_COL_WIDTHS.contract),
    term: toPt(EXCEL_COL_WIDTHS.term),
    rate: toPt(EXCEL_COL_WIDTHS.rate),
    progress: toPt(EXCEL_COL_WIDTHS.progress),
    received: toPt(EXCEL_COL_WIDTHS.received),
    unreceived: toPt(EXCEL_COL_WIDTHS.unreceived),
    month: toPt(EXCEL_COL_WIDTHS.month),
} as const;

/** 表の総幅（外枠の内側） */
export const TABLE_WIDTH =
    COL.code +
    COL.name +
    COL.contract +
    COL.term +
    COL.rate +
    COL.progress +
    COL.received +
    COL.unreceived +
    COL.month * 9;

/** 明細1段の高さ（1枠＝2段）。Excel の行高 20.1pt を 61% で刷ったときとほぼ同じ */
const DETAIL_ROW_H = 12.4;
const HEADER_ROW_H = 14;
const TOTAL_ROW_H = 13;
const TITLE_H = 34;
const AS_OF_H = 15;
const APPLICANT_H = 22;
const NOTE_LINE_H = 14;

const BORDER = '#000000';
/** 枠内の段区切り（契約先／工事名・着工／完成）。様式では点線 */
const INNER_BORDER = '#9ca3af';

/** 様式の下部にある定型文（テンプレの65・68・70行目と同じ） */
const NOTE_LINES = [
    '※　符号　　の　　月入金予定である　　　　　千円の工事代金を本件返済金に引当てることとし、当金融機関において資金管理をいたします。',
    '金融機関名　　　　　　　　　　　　　　　担当者名　　　　　　　　　　　　　　　印',
    '※特定の工事代金を返済財源とした短期資金の保証申込みにつきましては必ず記入・押印してください。',
] as const;

// ---------------------------------------------------------------- 書式

const FONT_DETAIL = 8;
const FONT_HEADER = 8;

/**
 * 行間（フォントサイズ比）。
 *
 * ⚠️ react-pdf の落とし穴が2つあるので、文字を出す <Text> には必ず
 *    「fontSize と lineHeight を同じスタイルオブジェクトで」指定すること。
 *    1. lineHeight だけ書いて fontSize を書かないと、その <Text> は**何も描かれない**
 *       （fontSize は Page から継承されるのに lineHeight の解決に使われない）。
 *    2. 行の高さ（fontSize × lineHeight）が親 View の height を超えると、
 *       はみ出すのではなく**丸ごと消える**。NotoSansJP の既定の行送りは約 1.45em あるので、
 *       12.4pt の枠に 11pt の文字を置くと消える＝ここで明示的に詰めている。
 */
const LINE_HEIGHT = 1.15;

/** 0（と未設定）は空欄。様式は未入力セルを空のままにしている */
const fmt = (value: number | undefined): string =>
    value ? value.toLocaleString('en-US') : '';

/** 0〜1 → '20%'。区分行（undefined）は空欄 */
const fmtRate = (rate: number | undefined): string =>
    rate === undefined || rate === 0 ? '' : `${Math.round(rate * 100)}%`;

/** セル内寸（左右padding 2 ずつ）に1行で収まるフォントサイズ */
const fit = (value: string, width: number, base = FONT_DETAIL): number =>
    fitCellFontSize(value, width - 4, base, 4.5);

// ---------------------------------------------------------------- スタイル

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: FONT_DETAIL,
        backgroundColor: '#ffffff',
        paddingLeft: PAGE_PADDING_X,
        paddingRight: PAGE_PADDING_X,
        paddingTop: PAGE_PADDING_TOP,
        paddingBottom: PAGE_PADDING_BOTTOM,
    },
    title: {
        height: TITLE_H,
        justifyContent: 'center',
        alignItems: 'center',
    },
    titleText: {
        fontSize: 20,
        lineHeight: 1.3,
        fontWeight: 'bold',
    },
    asOfRow: {
        height: AS_OF_H,
        flexDirection: 'row',
        alignItems: 'center',
    },
    asOfText: {
        fontSize: 11,
        lineHeight: 1.2,
        textAlign: 'center',
    },
    applicantRow: {
        height: APPLICANT_H,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
    },
    applicantText: {
        fontSize: 11,
        lineHeight: 1.2,
        textDecoration: 'underline',
    },
    unitText: {
        fontSize: 9,
        lineHeight: 1.2,
    },
    table: {
        width: TABLE_WIDTH,
        borderWidth: 1,
        borderColor: BORDER,
    },
    // --- 共通セル
    cell: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 2,
        paddingRight: 2,
        borderRightWidth: 0.5,
        borderRightColor: BORDER,
    },
    cellLast: {
        borderRightWidth: 0,
    },
    // --- 見出し
    headerBlock: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    headerText: {
        textAlign: 'center',
        fontSize: FONT_HEADER,
        lineHeight: LINE_HEIGHT,
    },
    // --- 明細
    frame: {
        flexDirection: 'row',
        height: DETAIL_ROW_H * 2,
        borderBottomWidth: 0.5,
        borderBottomColor: BORDER,
    },
    innerTop: {
        height: DETAIL_ROW_H,
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 2,
        paddingRight: 2,
        borderBottomWidth: 0.4,
        borderBottomColor: INNER_BORDER,
    },
    innerBottom: {
        height: DETAIL_ROW_H,
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 2,
        paddingRight: 2,
    },
    valueText: {
        fontSize: FONT_DETAIL,
        lineHeight: LINE_HEIGHT,
    },
    // --- 計
    totalRow: {
        flexDirection: 'row',
        height: TOTAL_ROW_H,
        borderTopWidth: 1,
        borderTopColor: BORDER,
    },
    notes: {
        marginTop: 8,
    },
    noteText: {
        fontSize: 9,
        height: NOTE_LINE_H,
        lineHeight: 1.2,
    },
});

// ---------------------------------------------------------------- 部品

/** 1段ぶんの値セル（枠の上半分に値を置き、下半分は空ける＝様式と同じ位置） */
function TopValueCell({
    width,
    value,
    align = 'center',
    last = false,
}: {
    width: number;
    value: string;
    align?: 'center' | 'right';
    last?: boolean;
}) {
    return (
        <View style={[styles.cell, { width }, last ? styles.cellLast : {}]}>
            <View style={{ height: DETAIL_ROW_H, width: '100%', justifyContent: 'center' }}>
                <Text
                    style={[
                        styles.valueText,
                        { fontSize: fit(value, width), textAlign: align },
                    ]}
                >
                    {value}
                </Text>
            </View>
            <View style={{ height: DETAIL_ROW_H }} />
        </View>
    );
}

/** 上下2段に別々の値を置くセル（契約先／工事名・着工／完成） */
function StackedCell({
    width,
    top,
    bottom,
    last = false,
}: {
    width: number;
    top: string;
    bottom: string;
    last?: boolean;
}) {
    return (
        <View
            style={[
                { width, borderRightWidth: 0.5, borderRightColor: BORDER },
                last ? styles.cellLast : {},
            ]}
        >
            <View style={styles.innerTop}>
                <Text style={[styles.valueText, { fontSize: fit(top, width) }]}>{top}</Text>
            </View>
            <View style={styles.innerBottom}>
                <Text style={[styles.valueText, { fontSize: fit(bottom, width) }]}>{bottom}</Text>
            </View>
        </View>
    );
}

/** 明細1枠（1案件＝2段）。空枠も様式どおり枠線だけ描く */
function DetailFrame({ row }: { row: RenderRow | undefined }) {
    if (!row) {
        return (
            <View style={styles.frame}>
                <View style={[styles.cell, { width: COL.code }]} />
                <View style={[styles.cell, { width: COL.name }]} />
                <View style={[styles.cell, { width: COL.contract }]} />
                <View style={[styles.cell, { width: COL.term }]} />
                <View style={[styles.cell, { width: COL.rate }]} />
                <View style={[styles.cell, { width: COL.progress }]} />
                <View style={[styles.cell, { width: COL.received }]} />
                <View style={[styles.cell, { width: COL.unreceived }]} />
                {Array.from({ length: 9 }, (_, i) => (
                    <View
                        key={i}
                        style={[styles.cell, { width: COL.month }, i === 8 ? styles.cellLast : {}]}
                    />
                ))}
            </View>
        );
    }

    return (
        <View style={styles.frame} wrap={false}>
            <View style={[styles.cell, { width: COL.code }]}>
                <Text style={styles.valueText}>{row.code}</Text>
            </View>
            <StackedCell width={COL.name} top={row.top} bottom={row.bottom} />
            <TopValueCell width={COL.contract} value={fmt(row.contractK)} />
            <StackedCell width={COL.term} top={row.startYm ?? ''} bottom={row.endYm ?? ''} />
            <TopValueCell width={COL.rate} value={fmtRate(row.progressRate)} />
            {/* 出来高金額だけ様式が右寄せ */}
            <TopValueCell width={COL.progress} value={fmt(row.progressAmountK)} align="right" />
            <TopValueCell width={COL.received} value={fmt(row.receivedK)} />
            <TopValueCell width={COL.unreceived} value={fmt(row.unreceivedK)} />
            {Array.from({ length: 9 }, (_, i) => (
                <TopValueCell
                    key={i}
                    width={COL.month}
                    value={fmt(row.scheduleK[i])}
                    last={i === 8}
                />
            ))}
        </View>
    );
}

/** 2段の見出し（8・9行目）。ページごとに繰り返す */
function HeaderBlock({ columns }: { columns: MonthColumn[] }) {
    const headerCell = (width: number, label: string, lines = 1) => (
        <View style={[styles.cell, { width, height: HEADER_ROW_H * 2 }]}>
            <Text
                style={[
                    styles.headerText,
                    { fontSize: fitCellFontSize(label, (width - 4) * lines, FONT_HEADER, 4.5) },
                ]}
            >
                {label}
            </Text>
        </View>
    );

    return (
        <View style={styles.headerBlock}>
            {headerCell(COL.code, '符号')}
            {/* 契約先（上段）／工事名（下段） */}
            <View style={{ width: COL.name, borderRightWidth: 0.5, borderRightColor: BORDER }}>
                <View style={[styles.innerTop, { height: HEADER_ROW_H, borderBottomColor: BORDER, borderBottomWidth: 0.5 }]}>
                    <Text style={styles.headerText}>契約先</Text>
                </View>
                <View style={[styles.innerBottom, { height: HEADER_ROW_H }]}>
                    <Text style={styles.headerText}>工事名</Text>
                </View>
            </View>
            {headerCell(COL.contract, '契約額')}
            {/* 工事着工日（上段）／完成予定日（下段） */}
            <View style={{ width: COL.term, borderRightWidth: 0.5, borderRightColor: BORDER }}>
                <View style={[styles.innerTop, { height: HEADER_ROW_H, borderBottomColor: BORDER, borderBottomWidth: 0.5 }]}>
                    <Text style={[styles.headerText, { fontSize: fit('工事着工日', COL.term, FONT_HEADER) }]}>
                        工事着工日
                    </Text>
                </View>
                <View style={[styles.innerBottom, { height: HEADER_ROW_H }]}>
                    <Text style={[styles.headerText, { fontSize: fit('完成予定日', COL.term, FONT_HEADER) }]}>
                        完成予定日
                    </Text>
                </View>
            </View>
            {/* 現在出来高（上段は G+H をまたぐ）／％・金額（下段） */}
            <View style={{ width: COL.rate + COL.progress, borderRightWidth: 0.5, borderRightColor: BORDER }}>
                <View style={[styles.innerTop, { height: HEADER_ROW_H, borderBottomColor: BORDER, borderBottomWidth: 0.5 }]}>
                    <Text style={styles.headerText}>現在出来高</Text>
                </View>
                <View style={{ flexDirection: 'row', height: HEADER_ROW_H }}>
                    <View style={[styles.cell, { width: COL.rate, height: HEADER_ROW_H }]}>
                        <Text style={styles.headerText}>％</Text>
                    </View>
                    <View style={[styles.cell, styles.cellLast, { width: COL.progress, height: HEADER_ROW_H }]}>
                        <Text style={styles.headerText}>金額</Text>
                    </View>
                </View>
            </View>
            {headerCell(COL.received, '既受領金額')}
            {/* 様式の文言は「現在出来高に対する　　未受領金額」（2行で出す） */}
            <View style={[styles.cell, { width: COL.unreceived, height: HEADER_ROW_H * 2 }]}>
                <Text
                    style={[
                        styles.headerText,
                        { fontSize: fit('現在出来高に対する', COL.unreceived, FONT_HEADER) },
                    ]}
                >
                    {'現在出来高に対する\n未受領金額'}
                </Text>
            </View>
            {/* 入金予定（上段は K〜S をまたぐ）／月（下段） */}
            <View style={{ width: COL.month * 9 }}>
                <View style={[styles.innerTop, { height: HEADER_ROW_H, borderBottomColor: BORDER, borderBottomWidth: 0.5 }]}>
                    <Text style={styles.headerText}>入金予定</Text>
                </View>
                <View style={{ flexDirection: 'row', height: HEADER_ROW_H }}>
                    {Array.from({ length: 9 }, (_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.cell,
                                { width: COL.month, height: HEADER_ROW_H },
                                i === 8 ? styles.cellLast : {},
                            ]}
                        >
                            <Text
                                style={[
                                    styles.headerText,
                                    { fontSize: fit(columns[i]?.label ?? '', COL.month, FONT_HEADER) },
                                ]}
                            >
                                {columns[i]?.label ?? ''}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

/** 計（62行目）。最終ページだけ中身を入れ、他のページは枠だけ（様式と同じ位置に線を残す） */
function TotalRow({ sheet, show }: { sheet: OrderBacklogSheet; show: boolean }) {
    const totals = sheet.totals;
    const cell = (
        key: string,
        width: number,
        value: string,
        align: 'center' | 'right' = 'center',
        last = false
    ) => (
        <View key={key} style={[styles.cell, { width, height: TOTAL_ROW_H }, last ? styles.cellLast : {}]}>
            <Text style={[styles.valueText, { fontSize: fit(value, width), textAlign: align }]}>
                {value}
            </Text>
        </View>
    );

    return (
        <View style={styles.totalRow}>
            <View style={[styles.cell, { width: COL.code + COL.name, height: TOTAL_ROW_H }]}>
                <Text style={styles.valueText}>{show ? '計' : ''}</Text>
            </View>
            {cell('contract', COL.contract, show ? totals.contractK.toLocaleString('en-US') : '')}
            {cell('term', COL.term, '')}
            {cell('rate', COL.rate, '')}
            {cell('progress', COL.progress, '')}
            {cell('received', COL.received, show ? totals.receivedK.toLocaleString('en-US') : '')}
            {cell('unreceived', COL.unreceived, show ? totals.unreceivedK.toLocaleString('en-US') : '')}
            {Array.from({ length: 9 }, (_, i) =>
                cell(
                    `m${i}`,
                    COL.month,
                    show ? (totals.scheduleK[i] ?? 0).toLocaleString('en-US') : '',
                    'center',
                    i === 8
                )
            )}
        </View>
    );
}

// ---------------------------------------------------------------- 本体

export interface OrderBacklogPDFProps {
    sheet: OrderBacklogSheet;
}

export function OrderBacklogPDF({ sheet }: OrderBacklogPDFProps) {
    // 26枠に満たないページも空枠を描いて様式の見た目を保つ
    const pages = sheet.pages.length > 0 ? sheet.pages : [[]];

    return (
        <Document>
            {pages.map((rows, pageIndex) => (
                <Page key={pageIndex} size="A3" orientation="landscape" style={styles.page}>
                    <View style={styles.title}>
                        <Text style={styles.titleText}>受　　注　　明　　細　　書</Text>
                    </View>

                    {/* 基準日は様式の F5:J5（＝契約額の右隣から未受領金額まで）に置く */}
                    <View style={styles.asOfRow}>
                        <View style={{ width: COL.code + COL.name + COL.contract }} />
                        <View
                            style={{
                                width: COL.term + COL.rate + COL.progress + COL.received + COL.unreceived,
                                alignItems: 'center',
                            }}
                        >
                            <Text style={styles.asOfText}>{sheet.asOfLabel}</Text>
                        </View>
                    </View>

                    <View style={[styles.applicantRow, { width: TABLE_WIDTH }]}>
                        <Text style={styles.applicantText}>{sheet.applicantLabel}</Text>
                        <Text style={styles.unitText}>（単位　千円）</Text>
                    </View>

                    <View style={styles.table}>
                        <HeaderBlock columns={sheet.columns} />
                        {Array.from({ length: ROWS_PER_PAGE }, (_, i) => (
                            <DetailFrame key={i} row={rows[i]} />
                        ))}
                        <TotalRow sheet={sheet} show={pageIndex === pages.length - 1} />
                    </View>

                    <View style={styles.notes}>
                        {NOTE_LINES.map((note, i) => (
                            <Text key={i} style={styles.noteText}>
                                {note}
                            </Text>
                        ))}
                    </View>
                </Page>
            ))}
        </Document>
    );
}

export default OrderBacklogPDF;
