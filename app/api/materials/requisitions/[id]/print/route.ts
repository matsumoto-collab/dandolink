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
        return serverErrorResponse('材料出庫伝票PDF生成', error);
    }
}
