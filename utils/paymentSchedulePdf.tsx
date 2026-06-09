'use client';

import { pdf } from '@react-pdf/renderer';
import { PaymentSchedulePDF } from '@/components/pdf/PaymentSchedulePDF';
import type { PaymentSchedule } from '@/types/paymentSchedule';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * PDF Blob を保存する（モバイルではWeb Share対応）
 */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle?: string): Promise<void> {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    // iPadOS 13+ の Safari は UA を Mac と名乗るため iPad 文字列で判定不可。
    // タッチ可能(maxTouchPoints>1)な Mac を iPad とみなす（本物の Mac は 0）。
    const isIpadOS = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || isIpadOS;
    if (
        isMobile &&
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })
    ) {
        try {
            // iOS では title/text が無いと LINE 等が共有シートに出ないため、短い定型文を title に渡す。
            // この文面が LINE では本文(1通目)として送られる（ファイル名そのものは送らない）。
            await nav.share(shareTitle ? { files: [file], title: shareTitle } : { files: [file] });
            return;
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 月末判定
 */
const isEndOfMonth = (d: Date): boolean => {
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return next.getMonth() !== d.getMonth();
};

/**
 * 支払予定リストをPDF出力してダウンロード
 */
export async function exportPaymentSchedulePDF(
    items: PaymentSchedule[],
    paymentDate: string
): Promise<void> {
    try {
        const blob = await pdf(
            <PaymentSchedulePDF items={items} paymentDate={paymentDate} />
        ).toBlob();

        // ファイル名生成（例: 支払予定表_令和8年4月末日.pdf）
        const d = new Date(paymentDate);
        const reiwaY = d.getFullYear() - 2018;
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const dayLabel = isEndOfMonth(d) ? '末日' : `${day}日`;
        const fileName = sanitizeFileName(
            `支払予定表_令和${reiwaY}年${month}月${dayLabel}.pdf`
        );

        await savePdfBlob(blob, fileName, '支払予定表をお送りします');
    } catch (error) {
        logger.error('支払予定PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Blob URLを生成（プレビュー用）
 */
export async function generatePaymentSchedulePDFBlob(
    items: PaymentSchedule[],
    paymentDate: string
): Promise<string> {
    try {
        const blob = await pdf(
            <PaymentSchedulePDF items={items} paymentDate={paymentDate} />
        ).toBlob();
        return URL.createObjectURL(blob);
    } catch (error) {
        logger.error('支払予定PDF生成エラー:', error);
        throw error;
    }
}
