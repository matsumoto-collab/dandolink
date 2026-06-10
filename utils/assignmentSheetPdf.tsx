'use client';

import { pdf } from '@react-pdf/renderer';
import { AssignmentSheetPDF, type AssignmentSheetPDFProps } from '@/components/pdf/AssignmentSheetPDF';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * PDF Blob を保存する（モバイルでは Web Share 対応）。
 * 他の PDF 出力（出来高表・支払予定表など）と同じ実装。
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
 * 手配表（作業日報）を PDF 出力してダウンロード／共有する。
 */
export async function exportAssignmentSheetPDF(props: AssignmentSheetPDFProps): Promise<void> {
    try {
        const blob = await pdf(<AssignmentSheetPDF {...props} />).toBlob();
        const d = props.date;
        const reiwaY = d.getFullYear() - 2018;
        const fileName = sanitizeFileName(`作業日報_令和${reiwaY}年${d.getMonth() + 1}月${d.getDate()}日.pdf`);
        await savePdfBlob(blob, fileName, '作業日報をお送りします');
    } catch (error) {
        logger.error('作業日報PDF生成エラー:', error);
        throw error;
    }
}
