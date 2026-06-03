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

// Shared color palette for PDF documents
export const PDF_COLORS = {
    navy: '#222222',
    navyLight: '#444444',
    headerBg: '#333333',
    headerText: '#ffffff',
    infoBg: '#f5f5f5',
    zebraStripe: '#fafafa',
    borderDark: '#333333',
    borderLight: '#d4d4d4',
    borderMedium: '#a3a3a3',
    textPrimary: '#1a1a1a',
    textSecondary: '#525252',
    red: '#dc2626',
    white: '#ffffff',
    totalBg: '#f0f0f0',
} as const;

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

/** フォント未対応の特殊Unicode文字を置換 */
export function sanitizePdfText(text: string): string {
    return text
        .replace(/㎡/g, 'm²')
        .replace(/㎥/g, 'm³')
        .replace(/㎝/g, 'cm')
        .replace(/㎜/g, 'mm')
        .replace(/㎞/g, 'km')
        .replace(/㏄/g, 'cc')
        // フォントサブセット(noto-sans-jp japanese)にグリフが無い文字 → 描画可能な等価字へ
        .replace(/～/g, '〜')   // U+FF5E 全角チルダ → U+301C 波ダッシュ
        .replace(/－/g, '−')   // U+FF0D 全角ハイフンマイナス → U+2212 マイナス
        .replace(/‐/g, '−')   // U+2010 ハイフン → U+2212 マイナス
        .replace(/―/g, '—');  // U+2015 水平バー → U+2014 emダッシュ
}

/**
 * セル幅に1行で収まるフォントサイズを算出する（折り返し防止）。
 *
 * NotoSansJP の全角グリフは概ね 1em 四方、半角(ASCII・半角ｶﾅ)は約 0.6em とみなし、
 * 推定描画幅 = Σ(文字幅) × フォントサイズ がセル内寸を超える場合だけ縮小する。
 * 既定サイズで収まる短い文字列はそのまま返す（拡大はしない）。最小サイズでクランプ。
 *
 * @param text         描画する文字列（sanitize 済みを渡すこと。文字数が幅に直結するため）
 * @param contentWidth セル内寸（cell width − 左右padding − 罫線）
 * @param baseFontSize 既定（最大）フォントサイズ
 * @param minFontSize  最小フォントサイズ（これ以下には縮小しない。既定 5）
 */
export function fitCellFontSize(
    text: string,
    contentWidth: number,
    baseFontSize: number,
    minFontSize = 5,
): number {
    let units = 0;
    for (const ch of text) units += /[\x00-\xff｡-ﾟ]/.test(ch) ? 0.6 : 1;
    if (units <= 0) return baseFontSize;
    // 0.98: 概算誤差ぶんの安全マージン（実寸がわずかに上振れしても折り返さないように）
    const needed = (contentWidth * 0.98) / units;
    if (needed >= baseFontSize) return baseFontSize;
    return Math.max(minFontSize, Math.floor(needed * 10) / 10);
}

// Helper function to format currency
export function formatCurrency(value: number): string {
    return `¥${value.toLocaleString()}`;
}
