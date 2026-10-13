import { NextRequest, NextResponse } from 'next/server';
import { notFoundResponse, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { roadPermitSymbolUpdateSchema } from '@/lib/validations/roadPermitSymbol';
import { updateRoadPermitSymbol } from '@/lib/roadPermitSymbolServer';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * PUT /api/road-permits/symbols/[id]  RoadPermitSymbolUpdatePayload（部分更新）
 * 名前・分類・数量の数え方・コーンバーの間隔・出どころ・並び順・使う／使わない を変える。
 * 形（geometry）・大きさ・取り込み元は変えない（送られてきても落とす）。無ければ 404。
 * broadcast はサーバーでは送らない（画面が保存後に road_permit_symbols_updated を送る）。
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(roadPermitSymbolUpdateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);

        const dto = await updateRoadPermitSymbol(params.id, parsed.data, session!.user.id);
        if (!dto) return notFoundResponse('記号');
        return NextResponse.json(dto, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('記号の変更', error);
    }
}
