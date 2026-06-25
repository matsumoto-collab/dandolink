import { NextRequest, NextResponse } from 'next/server';
import {
    requireAuth,
    serverErrorResponse,
    notFoundResponse,
    errorResponse,
    applyRateLimit,
    RATE_LIMITS,
} from '@/lib/api/utils';
import {
    renderMaterialRequisitionPrintPDF,
    buildPdfFileName,
    checkRequisitionAccess,
} from '@/lib/pdf/materialRequisitionPrint';

// PDF生成は Node ランタイム必須（@react-pdf/renderer は Edge 非対応）
export const runtime = 'nodejs';
// 動的ルート（毎リクエストで最新を返す）
export const dynamic = 'force-dynamic';
// react-pdf の初期化＋フォント読込でコールドスタート時に時間がかかり得るため余裕を持たせる
export const maxDuration = 60;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // PDF生成は重いため heavy プリセットで制限
        const rateLimitError = await applyRateLimit(request, RATE_LIMITS.heavy);
        if (rateLimitError) return rateLimitError;

        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        if (!id) return errorResponse('IDが指定されていません', 400);

        // 認可チェック（本人または admin/manager）
        const access = await checkRequisitionAccess([id], {
            id: session!.user.id,
            role: session!.user.role,
        });
        if (access.missingIds.length > 0) {
            return notFoundResponse('伝票');
        }
        if (!access.allowed) {
            return errorResponse('この伝票を閲覧する権限がありません', 403);
        }

        const buffer = await renderMaterialRequisitionPrintPDF([id]);

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${buildPdfFileName()}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        // ===== 一時デバッグ（診断後に削除）: 本番の実例外＋フォントパス解決を可視化 =====
        // ログ/Sentry へは通常どおり送出（戻り値は破棄）
        void serverErrorResponse('材料出庫伝票PDF生成', error);
        const e = error as Error;
        let fontDiag: Record<string, unknown> = {};
        try {
            const fs = await import('fs');
            const path = await import('path');
            const p = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf');
            fontDiag = { cwd: process.cwd(), fontPath: p, fontExists: fs.existsSync(p) };
        } catch (fe) {
            fontDiag = { fontDiagError: String(fe) };
        }
        return NextResponse.json(
            {
                error: '材料出庫伝票PDF生成に失敗しました',
                debug: {
                    name: e?.name,
                    message: e?.message,
                    stack: (e?.stack || '').split('\n').slice(0, 12),
                    ...fontDiag,
                },
            },
            { status: 500, headers: { 'Cache-Control': 'no-store' } },
        );
        // ===== 一時デバッグここまで =====
    }
}
