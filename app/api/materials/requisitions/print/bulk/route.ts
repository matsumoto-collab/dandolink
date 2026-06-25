import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
    requireAuth,
    serverErrorResponse,
    errorResponse,
    validationErrorResponse,
    applyRateLimit,
    RATE_LIMITS,
} from '@/lib/api/utils';
import {
    renderMaterialRequisitionPrintPDF,
    buildPdfFileName,
    checkRequisitionAccess,
} from '@/lib/pdf/materialRequisitionPrint';

// PDF生成は Node ランタイム必須
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 最大20件を連結生成するため単票より重い。コールドスタート＋フォント初期化に余裕を持たせる
export const maxDuration = 60;

// 一度に処理する伝票数の上限（OOM対策）
const MAX_BULK = 20;

// bulk POST のリクエストボディ
const bulkRequestSchema = z.object({
    ids: z
        .array(
            z
                .string()
                .min(1)
                .max(64)
                .regex(/^[a-zA-Z0-9_-]+$/, '伝票IDの形式が不正です')
        )
        .min(1)
        .max(MAX_BULK),
});

// POST: JSONボディで { ids: string[] } を受ける
export async function POST(request: NextRequest) {
    try {
        // PDF一括生成は重いため heavy プリセットで制限
        const rateLimitError = await applyRateLimit(request, RATE_LIMITS.heavy);
        if (rateLimitError) return rateLimitError;

        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json().catch(() => null);
        const parsed = bulkRequestSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('リクエスト形式が不正です');
        }

        const uniqueIds = Array.from(new Set(parsed.data.ids));
        if (uniqueIds.length === 0) {
            return validationErrorResponse('伝票IDが指定されていません');
        }
        if (uniqueIds.length > MAX_BULK) {
            return validationErrorResponse(`一度に印刷できる伝票は${MAX_BULK}件までです`);
        }

        const access = await checkRequisitionAccess(uniqueIds, {
            id: session!.user.id,
            role: session!.user.role,
        });
        if (access.missingIds.length > 0) {
            return errorResponse('該当しない伝票が含まれています', 404);
        }
        if (!access.allowed) {
            return errorResponse('該当しない伝票が含まれています', 403);
        }

        const buffer = await renderMaterialRequisitionPrintPDF(uniqueIds);

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${buildPdfFileName()}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票PDF一括生成', error);
    }
}
