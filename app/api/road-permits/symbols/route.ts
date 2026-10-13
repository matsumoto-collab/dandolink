import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { roadPermitSymbolCreateSchema } from '@/lib/validations/roadPermitSymbol';
import { createRoadPermitSymbol, loadRoadPermitSymbols } from '@/lib/roadPermitSymbolServer';
import type { RoadPermitSymbolsResponse } from '@/types/roadPermitSymbol';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/road-permits/symbols
 * 道路申請の図面に置く記号を全部（使わないものも含む・形も入れる）。並びは 分類 → 並び順 → 名前。
 * 権限は requireManagerOrAbove（admin / manager のみ）。
 */
export async function GET() {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body: RoadPermitSymbolsResponse = { symbols: await loadRoadPermitSymbols() };
        return NextResponse.json(body, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('記号の取得', error);
    }
}

/**
 * POST /api/road-permits/symbols  RoadPermitSymbolCreatePayload
 * 記号を 1 件登録する（並び順はその分類の最後）。201 で登録した記号を返す。
 * broadcast はサーバーでは送らない（画面が保存後に road_permit_symbols_updated を送る）。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(roadPermitSymbolCreateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);

        const dto = await createRoadPermitSymbol(parsed.data, session!.user.id);
        return NextResponse.json(dto, { status: 201, headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('記号の登録', error);
    }
}
