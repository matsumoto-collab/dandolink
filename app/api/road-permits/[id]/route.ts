import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    notFoundResponse,
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { roadPermitUpdateSchema } from '@/lib/validations/roadPermit';
import { ROAD_PERMIT_ROW_INCLUDE, toRoadPermitDto } from '@/lib/roadPermitServer';
import { normalizeRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import { normalizeRoadPermitDocuments } from '@/lib/roadPermit/defaults';
import { withPermitFilesFrom } from '@/lib/roadPermit/permitFiles';
import type { RoadPermitDocuments } from '@/types/roadPermit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/road-permits/[id]
 * 申請 1 件（消したものは 404）。権限は admin / manager のみ。
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const row = await prisma.roadPermit.findUnique({ where: { id: params.id }, include: ROAD_PERMIT_ROW_INCLUDE });
        if (!row || row.deletedAt !== null) return notFoundResponse('道路申請');

        return NextResponse.json(toRoadPermitDto(row), { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('道路申請の取得', error);
    }
}

/**
 * PUT /api/road-permits/[id]  { title, status, values, documents }
 * 保存（画面は常に全部の欄を送る）。消したものは 404。
 * broadcast はサーバーでは送らない（画面が保存後に送る）。
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(roadPermitUpdateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;

        const existing = await prisma.roadPermit.findUnique({
            where: { id: params.id },
            select: { id: true, deletedAt: true, documents: true },
        });
        if (!existing || existing.deletedAt !== null) return notFoundResponse('道路申請');

        // 許可書（スキャン）の一覧はサーバーだけが書く（付ける・消すは /files の API）。
        // 画面から来た permitFiles は捨てて DB の値を残す＝古い画面で開いたまま保存しても、
        // その間に付けたファイルの記録が消えない
        const documents = withPermitFilesFrom(
            input.documents as unknown as RoadPermitDocuments,
            normalizeRoadPermitDocuments(existing.documents),
        );

        // 図面: 省略なら変えない・null なら消す・あれば正規化して書く（Phase 2）
        const drawingData =
            input.drawing === undefined
                ? {}
                : input.drawing === null
                  ? { drawing: Prisma.DbNull }
                  : { drawing: normalizeRoadPermitDrawing(input.drawing) as unknown as Prisma.InputJsonValue };

        const updated = await prisma.roadPermit.update({
            where: { id: existing.id },
            data: {
                title: input.title,
                status: input.status,
                values: input.values as unknown as Prisma.InputJsonValue,
                documents: documents as unknown as Prisma.InputJsonValue,
                ...drawingData,
                updatedBy: session!.user.id,
            },
            include: ROAD_PERMIT_ROW_INCLUDE,
        });

        return NextResponse.json(toRoadPermitDto(updated), { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('道路申請の保存', error);
    }
}

/**
 * DELETE /api/road-permits/[id]
 * 論理削除（deletedAt を入れるだけ。行は残す）。もう消してあるもの・無いものは 404。
 * 確かめてから消すまでのすき間を作らないよう、条件つきの updateMany の件数で判定する。
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const result = await prisma.roadPermit.updateMany({
            where: { id: params.id, deletedAt: null },
            data: { deletedAt: new Date(), updatedBy: session!.user.id },
        });
        if (result.count === 0) return notFoundResponse('道路申請');

        return NextResponse.json({ ok: true, id: params.id }, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('道路申請の削除', error);
    }
}
