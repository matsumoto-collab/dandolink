'use client';

import { pdf } from '@react-pdf/renderer';
import {
    PartnerWorkVolumePDF,
    PartnerWorkVolumePDFProps,
} from '@/components/pdf/PartnerWorkVolumePDF';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

async function savePdfBlob(blob: Blob, fileName: string): Promise<void> {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (
        isMobile &&
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })
    ) {
        try {
            // title は付けない（iOSのLINE等がファイル名を本文テキストとして別送するため）
            await nav.share({ files: [file] });
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

export async function exportPartnerWorkVolumePDF(
    props: PartnerWorkVolumePDFProps
): Promise<void> {
    try {
        const blob = await pdf(<PartnerWorkVolumePDF {...props} />).toBlob();
        const reiwaY = props.year - 2018;
        const fileName = sanitizeFileName(
            `出来高表_${props.partnerCompanyName}_令和${reiwaY}年${props.month}月.pdf`
        );
        await savePdfBlob(blob, fileName);
    } catch (error) {
        logger.error('協力会社出来高PDF生成エラー:', error);
        throw error;
    }
}
