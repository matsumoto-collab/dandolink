'use client';

/**
 * 道路申請 PDF の出力（ブラウザ側）。
 *
 * utils/joyoStatementPdf.tsx と同じ作り: `pdf(<…/>).toBlob()` で Blob を作り、`saveBlobWithShare` で保存する。
 * 画面からは `await import('@/utils/roadPermitPdf')` で読み込む（react-pdf を最初の表示に含めない）。
 *
 * 選んだ様式（formIds）の順に、1 つの PDF へページを入れる（① 警察 → ② 松山市 提出用 → ③ 松山市 受け取り用）。
 * 様式ごとのページ部品は components/pdf/roadPermit/。
 */
import { pdf } from '@react-pdf/renderer';
import { RoadPermitDocument } from '@/components/pdf/roadPermit/RoadPermitDocument';
import { sortFormIds } from '@/lib/roadPermit/forms';
import type { RoadPermitPdfInput } from '@/types/roadPermit';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** プレビュー用の Blob。出す様式が 1 つも無ければ null（プレビューは「必要な情報を入力すると…」のまま） */
export async function generateRoadPermitPdfBlob(input: RoadPermitPdfInput): Promise<Blob | null> {
    const formIds = sortFormIds(input.formIds);
    const hasDrawing = input.includeDrawing === true && !!input.drawing && input.drawing.entities.length > 0;
    if (formIds.length === 0 && !hasDrawing) return null;
    return pdf(
        <RoadPermitDocument
            values={input.values}
            formIds={formIds}
            drawing={input.drawing ?? null}
            includeDrawing={input.includeDrawing === true}
        />,
    ).toBlob();
}

/** PDF を保存する（スマホは共有）。ファイル名＝`道路申請_<現場の場所 か 案件名>.pdf` */
export async function exportRoadPermitPDF(input: RoadPermitPdfInput): Promise<void> {
    try {
        const blob = await generateRoadPermitPdfBlob(input);
        if (!blob) throw new Error('出す様式を 1 つ以上選ぶか、図面を描いてください');
        const label = input.values.site.location || input.values.site.projectName || '申請書';
        const fileName = sanitizeFileName(`道路申請_${label}.pdf`);
        await saveBlobWithShare(blob, fileName, 'application/pdf', '道路申請の書類をお送りします');
    } catch (error) {
        logger.error('道路申請PDF生成エラー:', error);
        throw error;
    }
}
