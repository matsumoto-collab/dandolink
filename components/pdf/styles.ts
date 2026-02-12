import { StyleSheet, Font } from '@react-pdf/renderer';

// Register Japanese font (Noto Sans JP from CDN)
Font.register({
    family: 'NotoSansJP',
    fonts: [
        {
            src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-400-normal.woff',
            fontWeight: 'normal',
        },
        {
            src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-700-normal.woff',
            fontWeight: 'bold',
        },
    ],
});

// Common styles for PDF documents
export const commonStyles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        padding: 30,
        backgroundColor: '#ffffff',
    },
    landscapePage: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        padding: 30,
        backgroundColor: '#ffffff',
    },
    title: {
        fontSize: 22,
        textAlign: 'center',
        marginBottom: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: '#000000',
    },
    subtitle: {
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 20,
    },
    section: {
        marginBottom: 10,
    },
    row: {
        flexDirection: 'row',
        marginBottom: 3,
    },
    label: {
        width: 80,
        fontSize: 10,
    },
    value: {
        flex: 1,
        fontSize: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: '#000000',
    },
    table: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#000000',
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#f5f5f5',
        borderBottomWidth: 1,
        borderBottomColor: '#000000',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000000',
        minHeight: 20,
    },
    tableCell: {
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000000',
        justifyContent: 'center',
    },
    tableCellLast: {
        padding: 4,
        justifyContent: 'center',
    },
    textRight: {
        textAlign: 'right',
    },
    textCenter: {
        textAlign: 'center',
    },
    bold: {
        fontWeight: 'bold',
    },
    red: {
        color: '#ff0000',
    },
});

// Helper function to convert date to Reiwa format
export function toReiwa(date: Date, options?: { space?: boolean }): string {
    const year = date.getFullYear();
    const reiwaYear = year - 2018;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const sep = options?.space ? ' ' : '';
    return `令和${reiwaYear}年${sep}${month}月${day}日`;
}

// Helper function to format currency
export function formatCurrency(value: number): string {
    return `¥${value.toLocaleString()}`;
}
