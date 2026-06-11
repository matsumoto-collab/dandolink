'use client';

import { pdf } from '@react-pdf/renderer';
import { SagyoinMeiboPDF } from '@/components/pdf/SagyoinMeiboPDF';
import type { SagyoinMeiboData } from '@/lib/safetyDocuments';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * PDF Blob を保存する（モバイルでは Web Share 対応）。
 * 他の PDF 出力（作業日報・出来高表など）と同じ実装。
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

/** プレビュー用に PDF Blob を生成する（LivePdfPreview の renderPdf に渡す） */
export async function renderSagyoinMeiboBlob(data: SagyoinMeiboData): Promise<Blob> {
    return pdf(<SagyoinMeiboPDF data={data} />).toBlob();
}

/** 作業員名簿を PDF 出力してダウンロード／共有する */
export async function exportSagyoinMeiboPDF(data: SagyoinMeiboData, title: string): Promise<void> {
    try {
        const blob = await renderSagyoinMeiboBlob(data);
        const fileName = sanitizeFileName(`${title || '作業員名簿'}.pdf`);
        await savePdfBlob(blob, fileName, '作業員名簿をお送りします');
    } catch (error) {
        logger.error('作業員名簿PDF生成エラー:', error);
        throw error;
    }
}

/**
 * 印刷（FR-3-6）: 生成PDFの blob URL を新規タブで開き、ブラウザ内蔵PDFビューアの
 * 印刷機能を使う。canvas 描画（PdfViewer）への window.print() は崩れるため使わない。
 */
export async function printSagyoinMeiboPDF(data: SagyoinMeiboData): Promise<void> {
    const blob = await renderSagyoinMeiboBlob(data);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
        URL.revokeObjectURL(url);
        throw new Error('ポップアップがブロックされました。ブラウザの設定を確認してください。');
    }
    // 新規タブが PDF を読み終わる前に revoke すると表示に失敗するため遅延させる
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
