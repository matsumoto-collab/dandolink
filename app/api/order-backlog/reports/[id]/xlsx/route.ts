import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api/utils';
import { requireOrderBacklogAdmin } from '../../../_shared';
import { buildOrderBacklogSheet } from '@/lib/orderBacklog/render';
import { loadOrderBacklogReport } from '@/lib/orderBacklog/server';
import { buildOrderBacklogWorkbook } from '@/utils/orderBacklogExcelBuilder';

/**
 * GET /api/order-backlog/reports/[id]/xlsx
 *
 * 保存済みの受注明細書を、提出済みシートと同じ見た目の xlsx で返す（**admin のみ**）。
 * 集計は lib/orderBacklog/render.ts、組み立ては utils/orderBacklogExcelBuilder.ts で
 * 画面のプレビュー・PDF と共有している（二重実装にしない＝提出物と画面の数字がズレない）。
 *
 * テンプレをサーバーで読むので runtime='nodejs'（Vercel の関数へは next.config.js の
 * outputFileTracingIncludes で同梱している）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 提出済みシートから作ったテンプレ（scripts/build-order-backlog-excel-template.ts の生成物） */
const TEMPLATE_PATH = path.join(
    process.cwd(),
    'public',
    'templates',
    'order-backlog-template.xlsx'
);

/** テンプレートはプロセス内で使い回す（サーバーレスの温かいインスタンスで再読込しない） */
let templateCache: Buffer | null = null;

function loadTemplate(): Buffer {
    if (!templateCache) templateCache = fs.readFileSync(TEMPLATE_PATH);
    return templateCache;
}

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
    // 受注明細書は admin 専用（role の大文字小文字は _shared 側で吸収している）
    const { error } = await requireOrderBacklogAdmin();
    if (error) return error;

    try {
        const { id } = await context.params;
        const loaded = await loadOrderBacklogReport(id);
        if (!loaded) return errorResponse('受注明細書が見つかりません', 404);

        const { report, lines } = loaded;
        const sheet = buildOrderBacklogSheet(report, lines);
        const bytes = await buildOrderBacklogWorkbook(loadTemplate(), sheet);

        const stamp = report.asOfDate.replace(/-/g, '');
        const asciiName = `order-backlog_${stamp}.xlsx`;
        const jpName = `受注明細書_${stamp}.xlsx`;

        return new NextResponse(Buffer.from(bytes), {
            headers: {
                'Content-Type': XLSX_MIME,
                // 日本語ファイル名は RFC 5987 形式で渡す（対応していない環境向けに ASCII 名も付ける）
                'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(jpName)}`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (e) {
        logger.error('[order-backlog/xlsx] 生成に失敗', e);
        return errorResponse('受注明細書Excelの生成に失敗しました', 500);
    }
}
