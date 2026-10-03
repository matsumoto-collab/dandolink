/**
 * 評価ポイント: 点数表の項目1つ（docs/指示書_評価ポイント.md の 6-1。共通の決まりは 6-0）。
 *
 *   PATCH  /api/evaluation-points/items/[id]   { name?, description?, inputBy?, isActive? } の指定されたものだけ直す。admin
 *   DELETE /api/evaluation-points/items/[id]   記録が1件も無い項目だけ削除する（点数の履歴は一緒に消える）。admin
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    EVALUATION_POINT_DESCRIPTION_MAX,
    EVALUATION_POINT_NAME_MAX,
    isEvaluationPointAdmin,
    todayJstDateKey,
} from '@/lib/evaluationPoints';
import { actorOf, loadRatesByItemId } from '@/lib/evaluationPointsServer';
import { NO_STORE, asObject, parseInputBy, parseName, parseOptionalText, toItemResponse } from '../_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

const HAS_RECORDS_MESSAGE = '記録があるので削除できません。『使わない』にしてください';

/** 直せる列 */
interface ItemPatch {
    name?: string;
    description?: string | null;
    inputBy?: string;
    isActive?: boolean;
}

/** body から、指定された列だけを読む。形が違う列が1つでもあれば null。何も指定が無いときも null */
function parsePatchBody(body: Record<string, unknown>): ItemPatch | null {
    const patch: ItemPatch = {};
    if (body.name !== undefined) {
        const name = parseName(body.name, EVALUATION_POINT_NAME_MAX);
        if (!name) return null;
        patch.name = name;
    }
    if (body.description !== undefined) {
        const description = parseOptionalText(body.description, EVALUATION_POINT_DESCRIPTION_MAX);
        if (!description.ok) return null;
        patch.description = description.value;
    }
    if (body.inputBy !== undefined) {
        const inputBy = parseInputBy(body.inputBy);
        if (!inputBy) return null;
        patch.inputBy = inputBy;
    }
    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') return null;
        patch.isActive = body.isActive;
    }
    return Object.keys(patch).length === 0 ? null : patch;
}

// ================================================================ PATCH

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const body = asObject(await req.json().catch(() => null));
        const patch = body ? parsePatchBody(body) : null;
        if (!patch) return validationErrorResponse('入力が不正です');

        const current = await prisma.evaluationPointItem.findUnique({
            where: { id: params.id },
            select: {
                id: true, name: true, description: true, inputBy: true, isActive: true, sortOrder: true,
                _count: { select: { records: true } },
            },
        });
        if (!current) return notFoundResponse('項目');

        // 同じ名前の項目（使っていない項目も含めて比べる。自分自身は除く）
        if (patch.name !== undefined && patch.name !== current.name) {
            const sameName = await prisma.evaluationPointItem.findFirst({
                where: { name: patch.name, id: { not: current.id } },
                select: { id: true },
            });
            if (sameName) return errorResponse('同じ名前の項目が、すでにあります', 400);
        }

        // 変わった列だけを直し、ログにも変わった列だけを書く
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
            if (patch[key] !== current[key]) {
                before[key] = current[key];
                after[key] = patch[key];
            }
        }

        let updated = current;
        if (Object.keys(after).length > 0) {
            updated = await prisma.$transaction(async (tx) => {
                const row = await tx.evaluationPointItem.update({
                    where: { id: current.id },
                    data: after as ItemPatch,
                    select: {
                        id: true, name: true, description: true, inputBy: true, isActive: true, sortOrder: true,
                        _count: { select: { records: true } },
                    },
                });
                await tx.evaluationPointLog.create({
                    data: {
                        action: 'item_updated',
                        actorId: actor.id,
                        actorName: actor.name,
                        itemId: current.id,
                        detail: { before, after } as Prisma.InputJsonObject,
                    },
                });
                return row;
            });
        }

        const ratesByItemId = await loadRatesByItemId([updated.id]);
        return NextResponse.json(
            { item: toItemResponse(updated, ratesByItemId.get(updated.id) ?? [], updated._count.records, todayJstDateKey()) },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('評価ポイントの項目の更新', err);
    }
}

// ================================================================ DELETE

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const item = await prisma.evaluationPointItem.findUnique({ where: { id: params.id } });
        if (!item) return notFoundResponse('項目');

        // 記録が1件でもある項目は消せない（「使わない」にしてもらう）
        const recordCount = await prisma.evaluationPointRecord.count({ where: { itemId: item.id } });
        if (recordCount > 0) return errorResponse(HAS_RECORDS_MESSAGE, 400);

        try {
            await prisma.$transaction(async (tx) => {
                // 点数の履歴は、外部キーの onDelete: Cascade で一緒に消える
                await tx.evaluationPointItem.delete({ where: { id: item.id } });
                await tx.evaluationPointLog.create({
                    data: {
                        action: 'item_deleted',
                        actorId: actor.id,
                        actorName: actor.name,
                        itemId: item.id,
                        // 削除した項目の全部の列
                        detail: {
                            id: item.id,
                            name: item.name,
                            description: item.description,
                            inputBy: item.inputBy,
                            sortOrder: item.sortOrder,
                            isActive: item.isActive,
                            createdBy: item.createdBy,
                            createdAt: item.createdAt.toISOString(),
                            updatedAt: item.updatedAt.toISOString(),
                        },
                    },
                });
            });
        } catch (err) {
            // 確かめてから消すまでのあいだに記録が付いた（記録の外部キーは onDelete: Restrict）
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
                return errorResponse(HAS_RECORDS_MESSAGE, 400);
            }
            throw err;
        }

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの項目の削除', err);
    }
}
