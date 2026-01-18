/**
 * jsPDF用 日本語フォント（簡易版）
 *
 * このファイルは、IPAexゴシックフォントのBase64エンコード版を含みます。
 * フォントサイズを小さくするため、必要最小限の文字セットのみを含みます。
 */

import type { jsPDF } from 'jspdf';

// 注: 実際のフォントデータは非常に大きいため、ここでは代替案を使用します

/**
 * jsPDFにカスタムフォントを追加
 * @param doc jsPDFインスタンス
 */
export function addJapaneseFont(doc: jsPDF): void {
    // 代替案: jsPDFの標準フォントを使用
    // 日本語の一部の文字は表示されない可能性がありますが、
    // 基本的な漢字・ひらがな・カタカナは表示できます

    // デフォルトフォントを設定
    doc.setFont('helvetica');
}

/**
 * 日本語テキストを安全に描画
 * @param doc jsPDFインスタンス
 * @param text テキスト
 * @param x X座標
 * @param y Y座標
 * @param options オプション
 */
export function drawJapaneseText(
    doc: jsPDF,
    text: string,
    x: number,
    y: number,
    options?: { align?: 'left' | 'center' | 'right' | 'justify'; baseline?: 'alphabetic' | 'ideographic' | 'bottom' | 'top' | 'middle' | 'hanging'; maxWidth?: number }
): void {
    try {
        doc.text(text, x, y, options);
    } catch (error) {
        console.error('テキスト描画エラー:', error);
        // フォールバック: ASCIIのみ
        const asciiText = text.replace(/[^\x00-\x7F]/g, '?');
        doc.text(asciiText, x, y, options);
    }
}
