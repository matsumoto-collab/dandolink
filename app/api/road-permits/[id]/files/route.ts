import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, notFoundResponse, requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { isRoadPermitFormId } from '@/lib/roadPermit/forms';
import { ROAD_PERMIT_FILE_MAX_BYTES, permitFileExtension } from '@/lib/roadPermit/permitFiles';
import { addRoadPermitFile } from '@/lib/roadPermitFilesServer';
import { toRoadPermitDto } from '@/lib/roadPermitServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/road-permits/[id]/files  multipart（formId・file）
 * 許可が出た書類（スキャン。PDF・画像・20MB まで）を様式の欄に付ける。権限は admin / manager のみ。
 * 成功は 201 で申請 1 件（DTO）を返す。
 * ※ Vercel の実際の上限は約 4.5MB（超えると 413 が先に返る＝画面で案内する）
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const formData = await req.formData().catch(() => null);
        if (!formData) return errorResponse('送られてきた内容を読めませんでした', 400);
        const file = formData.get('file');
        const formId = formData.get('formId');
        if (!file || typeof file === 'string') return errorResponse('ファイルが選ばれていません', 400);
        if (!isRoadPermitFormId(formId)) return errorResponse('未知の様式です', 400);
        if (!permitFileExtension(file.type)) return errorResponse('PDF か画像のファイルを選んでください', 400);
        if (file.size > ROAD_PERMIT_FILE_MAX_BYTES) return errorResponse('ファイルが大きすぎます（20MB まで）', 400);

        const buffer = Buffer.from(await file.arrayBuffer());
        const updated = await addRoadPermitFile({
            permitId: params.id,
            formId,
            file: { name: file.name, type: file.type, size: file.size, buffer },
            user: { id: session!.user.id, name: session!.user.name ?? '' },
        });
        if (updated === null) return notFoundResponse('道路申請');
        if (updated === 'invalid') return errorResponse('このファイルは付けられません', 400);

        return NextResponse.json(toRoadPermitDto(updated), { status: 201, headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('許可書の保存', error);
    }
}
