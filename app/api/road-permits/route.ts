import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    notFoundResponse,
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { roadPermitCreateSchema, roadPermitsQuerySchema } from '@/lib/validations/roadPermit';
import {
    buildCopiedRoadPermitDocuments,
    buildCopiedRoadPermitValues,
    buildDefaultRoadPermitDocuments,
    buildDefaultRoadPermitTitle,
    buildDefaultRoadPermitValues,
    normalizeRoadPermitDocuments,
    normalizeRoadPermitValues,
} from '@/lib/roadPermit/defaults';
import {
    ROAD_PERMIT_PROJECT_SELECT,
    ROAD_PERMIT_ROW_INCLUDE,
    loadPreviousRoadPermitValues,
    loadRoadPermitCompanyDefaults,
    projectSourceOf,
    toRoadPermitDto,
    toRoadPermitListItem,
} from '@/lib/roadPermitServer';
import type { RoadPermitDocuments, RoadPermitsListResponse, RoadPermitValues } from '@/types/roadPermit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/road-permits?status=&projectMasterId=
 * 道路申請の一覧（消していないもの・更新が新しい順）。新しく作るときの初期値に使う自社情報と前回の入力値も一緒に返す。
 * 権限は requireManagerOrAbove（admin / manager のみ。ロールは lib/auth.ts で小文字化済み）。
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const sp = req.nextUrl.searchParams;
        const parsed = validateRequest(roadPermitsQuerySchema, {
            status: sp.get('status') ?? undefined,
            projectMasterId: sp.get('projectMasterId') ?? undefined,
        });
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const { status, projectMasterId } = parsed.data;

        const [rows, company, previous] = await Promise.all([
            prisma.roadPermit.findMany({
                where: {
                    deletedAt: null,
                    ...(status ? { status } : {}),
                    ...(projectMasterId ? { projectMasterId } : {}),
                },
                include: ROAD_PERMIT_ROW_INCLUDE,
                orderBy: { updatedAt: 'desc' },
            }),
            loadRoadPermitCompanyDefaults(),
            loadPreviousRoadPermitValues(),
        ]);

        const body: RoadPermitsListResponse = {
            permits: rows.map(toRoadPermitListItem),
            company,
            previous,
        };
        return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('道路申請の一覧取得', error);
    }
}

/**
 * POST /api/road-permits  { projectMasterId, fromId? }
 * 案件を選んで新しく作る。fromId があればその申請の入力値を写す（「この申請をコピーして作る」）。
 * 無ければ 自社情報・案件・前回の申請 から自動入力する（指示書 §7）。
 * broadcast はサーバーでは送らない（lib/broadcastChannel.ts はブラウザ専用。画面が作成後に送る）。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(roadPermitCreateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const { projectMasterId, fromId } = parsed.data;

        const projectRow = await prisma.projectMaster.findUnique({
            where: { id: projectMasterId },
            select: ROAD_PERMIT_PROJECT_SELECT,
        });
        if (!projectRow) return notFoundResponse('案件');
        const project = projectSourceOf(projectRow);

        let values: RoadPermitValues;
        let documents: RoadPermitDocuments;
        if (fromId) {
            const source = await prisma.roadPermit.findUnique({ where: { id: fromId } });
            if (!source || source.deletedAt !== null) return notFoundResponse('コピー元の申請');
            values = buildCopiedRoadPermitValues({
                source: normalizeRoadPermitValues(source.values),
                project,
                // 同じ案件なら現場・期間もそのまま写す。違う案件なら案件から入れ直す
                sameProject: source.projectMasterId === project.id,
            });
            documents = buildCopiedRoadPermitDocuments(normalizeRoadPermitDocuments(source.documents));
        } else {
            const [company, previous] = await Promise.all([
                loadRoadPermitCompanyDefaults(),
                loadPreviousRoadPermitValues(),
            ]);
            values = buildDefaultRoadPermitValues({ company, project, previous });
            documents = buildDefaultRoadPermitDocuments();
        }

        const userId = session!.user.id;
        const created = await prisma.roadPermit.create({
            data: {
                projectMasterId: project.id,
                title: buildDefaultRoadPermitTitle(project),
                status: 'draft',
                values: values as unknown as Prisma.InputJsonValue,
                documents: documents as unknown as Prisma.InputJsonValue,
                createdBy: userId,
                updatedBy: userId,
            },
            include: ROAD_PERMIT_ROW_INCLUDE,
        });

        return NextResponse.json(toRoadPermitDto(created), { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('道路申請の作成', error);
    }
}
