'use client';

/**
 * Blob をファイルとして保存する汎用関数（モバイルではWeb Share対応）。
 * PDF出力・Excel出力の双方から利用する。
 *
 * @param blob      保存する中身
 * @param fileName  保存ファイル名（拡張子込み）
 * @param mimeType  File に付与する MIME タイプ
 * @param shareTitle Web Share 時のタイトル（省略可）
 */
export async function saveBlobWithShare(
    blob: Blob,
    fileName: string,
    mimeType: string,
    shareTitle?: string
): Promise<void> {
    const file = new File([blob], fileName, { type: mimeType });
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

/** ファイル名に使えない文字を除去 */
export function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}
