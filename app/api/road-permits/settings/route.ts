import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { roadPermitSettingsSchema } from '@/lib/validations/roadPermit';
import { loadRoadPermitContacts, saveRoadPermitContacts } from '@/lib/roadPermitServer';
import type { RoadPermitSettingsResponse } from '@/types/roadPermit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/road-permits/settings
 * 道路申請の設定＝担当者の候補の並び { contacts: [{ name, phone }] }。
 * 権限は requireManagerOrAbove（admin / manager のみ。ロールは lib/auth.ts で小文字化済み）。
 * ※ 一覧（GET /api/road-permits）も同じ contacts を一緒に返すので、画面は普段そちらを使う。
 */
export async function GET() {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body: RoadPermitSettingsResponse = { contacts: await loadRoadPermitContacts() };
        return NextResponse.json(body, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('道路申請の設定の取得', error);
    }
}

/**
 * PUT /api/road-permits/settings  { contacts: [{ name, phone }] }
 * 担当者の候補を丸ごと置き換える（並び順＝選ぶ欄の順）。名前は必須・電話は空でもよい。行が無ければ作る。
 * broadcast はサーバーでは送らない（画面が保存後に road_permits_updated を送る）。
 */
export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(roadPermitSettingsSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);

        const contacts = await saveRoadPermitContacts(parsed.data.contacts, session!.user.id);
        const res: RoadPermitSettingsResponse = { contacts };
        return NextResponse.json(res, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('道路申請の設定の保存', error);
    }
}
