import { NextRequest, NextResponse } from 'next/server';
import { notFoundResponse, requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { removeRoadPermitFile, roadPermitFileSignedUrl } from '@/lib/roadPermitFilesServer';
import { toRoadPermitDto } from '@/lib/roadPermitServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

type Ctx = { params: { id: string; fileId: string } };

/**
 * GET /api/road-permits/[id]/files/[fileId]
 * 許可書（スキャン）を開く＝署名付き URL（10 分）へ転送する。権限は admin / manager のみ。
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const url = await roadPermitFileSignedUrl({ permitId: params.id, fileId: params.fileId });
        if (!url) return notFoundResponse('許可書');

        return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('許可書を開く', error);
    }
}

/**
 * DELETE /api/road-permits/[id]/files/[fileId]
 * 許可書（スキャン）を消す（Storage と記録）。200 で申請 1 件（DTO）を返す。権限は admin / manager のみ。
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const updated = await removeRoadPermitFile({ permitId: params.id, fileId: params.fileId, userId: session!.user.id });
        if (updated === null || updated === 'not-found') return notFoundResponse(updated === null ? '道路申請' : '許可書');

        return NextResponse.json(toRoadPermitDto(updated), { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('許可書の削除', error);
    }
}
