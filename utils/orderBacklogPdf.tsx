'use client';

/**
 * 受注明細書 PDF のクライアント側エクスポート。
 * utils/paymentSchedulePdf.tsx と同じ作り（pdf().toBlob() → ダウンロード）。
 */
import { pdf } from '@react-pdf/renderer';
import { OrderBacklogPDF } from '@/components/pdf/OrderBacklogPDF';
import type { OrderBacklogSheet } from '@/lib/orderBacklog/render';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/** 受注明細書をPDF出力してダウンロードする */
export async function exportOrderBacklogPDF(sheet: OrderBacklogSheet, fileName: string): Promise<void> {
    try {
        const blob = await pdf(<OrderBacklogPDF sheet={sheet} />).toBlob();
        const safeName = sanitizeFileName(fileName) || '受注明細書.pdf';
        const name = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        logger.error('受注明細書PDF生成エラー:', error);
        throw error;
    }
}

/** Blob URL を生成（プレビュー用） */
export async function generateOrderBacklogPDFBlob(sheet: OrderBacklogSheet): Promise<string> {
    try {
        const blob = await pdf(<OrderBacklogPDF sheet={sheet} />).toBlob();
        return URL.createObjectURL(blob);
    } catch (error) {
        logger.error('受注明細書PDF生成エラー:', error);
        throw error;
    }
}
