'use client';

/**
 * 工程表 PDF（A3横）のクライアント側エクスポート。
 * utils/orderBacklogPdf.tsx と同じ作り（pdf().toBlob() → 保存）。
 */
import { pdf } from '@react-pdf/renderer';
import { ScheduleChartPDF, type ScheduleChartMeta } from '@/components/pdf/ScheduleChartPDF';
import {
    buildScheduleChart,
    type ScheduleChartConstructionTypeInput,
    type ScheduleChartInputProject,
} from '@/lib/scheduleChart';
import { saveBlobWithShare } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

export interface ExportScheduleChartParams {
    projects: ScheduleChartInputProject[];
    constructionTypes: ScheduleChartConstructionTypeInput[];
    /** term を省略すると対象案件の実期間（最初〜最後の配置日）が入る */
    meta?: ScheduleChartMeta;
    fileName?: string;
}

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

export async function exportScheduleChartPDF({
    projects,
    constructionTypes,
    meta = {},
    fileName,
}: ExportScheduleChartParams): Promise<void> {
    try {
        const chart = buildScheduleChart(projects, constructionTypes);
        const blob = await pdf(
            <ScheduleChartPDF chart={chart} meta={{ ...meta, term: meta.term ?? chart.termLabel }} />,
        ).toBlob();

        const base = sanitizeFileName(fileName || '工程表') || '工程表';
        const name = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
        await saveBlobWithShare(blob, name, 'application/pdf', '工程表');
    } catch (error) {
        logger.error('工程表PDF生成エラー:', error);
        throw error;
    }
}
