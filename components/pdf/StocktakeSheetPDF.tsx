import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

/**
 * 棚卸チェックシート（印刷用）。
 *
 * エクセルの「土場材料表」シート（品名 + サイズ + 空欄の白紙表）の置き換え。
 * 違いは前回数えた数を薄く刷ってあること。土場で電波が届かない・手袋で
 * 画面が押せないときは、これを持って書いてから後で入力する。
 */

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        paddingTop: 24,
        paddingBottom: 20,
        paddingHorizontal: 20,
        fontSize: 7,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 8,
        paddingBottom: 4,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    title: { fontSize: 12, fontWeight: 'bold' },
    subtitle: { fontSize: 8, color: '#555' },
    columns: { flexDirection: 'row', gap: 8 },
    column: { flex: 1 },
    categoryRow: {
        backgroundColor: '#eef2f5',
        paddingVertical: 2,
        paddingHorizontal: 3,
        borderTopWidth: 0.5,
        borderTopColor: '#999',
    },
    categoryText: { fontSize: 7, fontWeight: 'bold' },
    itemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 13,
        borderBottomWidth: 0.5,
        borderBottomColor: '#ccc',
    },
    itemName: { flex: 1, paddingLeft: 4, fontSize: 7 },
    prev: { width: 30, textAlign: 'right', fontSize: 6, color: '#999', paddingRight: 3 },
    // 記入欄。罫線で囲って手書きしやすくする
    writeBox: {
        width: 40,
        height: 13,
        borderLeftWidth: 0.5,
        borderLeftColor: '#999',
    },
    unit: { width: 12, fontSize: 6, color: '#999', paddingLeft: 2 },
    footer: { marginTop: 6, fontSize: 6, color: '#888' },
});

export interface SheetEntry {
    kind: 'category' | 'item';
    label: string;
    unit?: string;
    previousQuantity?: number | null;
}

export interface StocktakeSheetPDFProps {
    /** 見出し（例: 土場 / 通常足場） */
    heading: string;
    /** 棚卸日（例: 2026/09/11） */
    dateLabel: string;
    /** 前回の棚卸日（例: 2026/07/28）。無ければ空文字 */
    previousDateLabel: string;
    entries: SheetEntry[];
    /** 1 列あたりの行数 */
    rowsPerColumn?: number;
    /** 1 ページあたりの列数 */
    columnsPerPage?: number;
}

/** entries を「ページ × 列」に切り分ける。カテゴリ見出しが列の最後に落ちないよう次列へ送る */
function paginate(entries: SheetEntry[], rowsPerColumn: number, columnsPerPage: number): SheetEntry[][][] {
    const columns: SheetEntry[][] = [];
    let current: SheetEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isOrphanHeading =
            entry.kind === 'category' && current.length >= rowsPerColumn - 1;
        if (current.length >= rowsPerColumn || isOrphanHeading) {
            columns.push(current);
            current = [];
        }
        current.push(entry);
    }
    if (current.length) columns.push(current);

    const pages: SheetEntry[][][] = [];
    for (let i = 0; i < columns.length; i += columnsPerPage) {
        pages.push(columns.slice(i, i + columnsPerPage));
    }
    return pages.length ? pages : [[[]]];
}

export function StocktakeSheetPDF({
    heading,
    dateLabel,
    previousDateLabel,
    entries,
    rowsPerColumn = 54,
    columnsPerPage = 3,
}: StocktakeSheetPDFProps) {
    const pages = paginate(entries, rowsPerColumn, columnsPerPage);

    return (
        <Document>
            {pages.map((columns, pageIndex) => (
                <Page key={pageIndex} size="A4" style={styles.page}>
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.title}>棚卸チェックシート　{heading}</Text>
                            <Text style={styles.subtitle}>
                                棚卸日 {dateLabel}
                                {previousDateLabel ? `　　前回 ${previousDateLabel}` : ''}
                            </Text>
                        </View>
                        <Text style={styles.subtitle}>
                            {pageIndex + 1} / {pages.length}　記入者
                        </Text>
                    </View>

                    <View style={styles.columns}>
                        {columns.map((column, colIndex) => (
                            <View key={colIndex} style={styles.column}>
                                {column.map((entry, rowIndex) =>
                                    entry.kind === 'category' ? (
                                        <View key={rowIndex} style={styles.categoryRow}>
                                            <Text style={styles.categoryText}>{entry.label}</Text>
                                        </View>
                                    ) : (
                                        <View key={rowIndex} style={styles.itemRow}>
                                            <Text style={styles.itemName}>{entry.label}</Text>
                                            <Text style={styles.prev}>
                                                {entry.previousQuantity === null || entry.previousQuantity === undefined
                                                    ? ''
                                                    : entry.previousQuantity.toLocaleString()}
                                            </Text>
                                            <View style={styles.writeBox} />
                                            <Text style={styles.unit}>{entry.unit ?? ''}</Text>
                                        </View>
                                    ),
                                )}
                            </View>
                        ))}
                    </View>

                    {pageIndex === pages.length - 1 && (
                        <Text style={styles.footer}>
                            うすい数字は前回数えた数です。数えていない品目は空欄のままにしてください（0 本と区別します）。
                        </Text>
                    )}
                </Page>
            ))}
        </Document>
    );
}
