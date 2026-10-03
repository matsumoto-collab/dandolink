/**
 * 評価ポイント: 点数表の項目（docs/指示書_評価ポイント.md の 6-1。共通の決まりは 6-0）。
 *
 *   GET  /api/evaluation-points/items   全項目（sortOrder 順）。admin・manager
 *   POST /api/evaluation-points/items   項目と、最初の点数の行（適用開始日 = 日本時間の今日）を作る。admin
 *
 * だれが何をできるか・どの点数を使うかは、lib/evaluationPoints.ts の関数で決める（ここに決まりを書き直さない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    EVALUATION_POINT_DESCRIPTION_MAX,
    EVALUATION_POINT_NAME_MAX,
    dateKeyToDate,
    isEvaluationPointAdmin,
    isEvaluationPointManager,
    isValidPoints,
    todayJstDateKey,
} from '@/lib/evaluationPoints';
import { actorOf, loadRatesByItemId } from '@/lib/evaluationPointsServer';
import { NO_STORE, asObject, parseInputBy, parseName, parseOptionalText, toItemResponse } from './_shared';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

// ================================================================ GET

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        // 職長向けの項目の一覧は GET /day が返すので、ここは管理者・マネージャーだけ
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const rows = await prisma.evaluationPointItem.findMany({
            // sortOrder が同じ項目どうしは、作った順
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
                id: true, name: true, description: true, inputBy: true, isActive: true, sortOrder: true,
                _count: { select: { records: true } },
            },
        });
        const ratesByItemId = await loadRatesByItemId(rows.map((r) => r.id));
        const today = todayJstDateKey();

        // 応答は、項目の配列そのもの（指示書 6-1）
        return NextResponse.json(
            rows.map((r) => toItemResponse(r, ratesByItemId.get(r.id) ?? [], r._count.records, today)),
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('評価ポイントの項目の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const name = parseName(body.name, EVALUATION_POINT_NAME_MAX);
        const description = parseOptionalText(body.description === undefined ? null : body.description, EVALUATION_POINT_DESCRIPTION_MAX);
        const inputBy = parseInputBy(body.inputBy);
        const points = body.points;
        if (!name || !description.ok || !inputBy || !isValidPoints(points)) {
            return validationErrorResponse('入力が不正です');
        }

        // ---- 同じ名前の項目（使っていない項目も含めて比べる）
        const sameName = await prisma.evaluationPointItem.findFirst({ where: { name }, select: { id: true } });
        if (sameName) return errorResponse('同じ名前の項目が、すでにあります', 400);

        // 並び順は、今の最大 + 1（項目が無ければ 0）
        const last = await prisma.evaluationPointItem.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
        const sortOrder = last ? last.sortOrder + 1 : 0;

        // 最初の点数の行は、日本時間の今日から
        const today = todayJstDateKey();
        const effectiveFrom = dateKeyToDate(today)!;

        const created = await prisma.$transaction(async (tx) => {
            const item = await tx.evaluationPointItem.create({
                data: {
                    name,
                    description: description.value,
                    inputBy,
                    sortOrder,
                    isActive: true,
                    createdBy: actor.id,
                },
                select: { id: true, name: true, description: true, inputBy: true, isActive: true, sortOrder: true },
            });
            const rate = await tx.evaluationPointRate.create({
                data: {
                    itemId: item.id,
                    points,
                    effectiveFrom,
                    createdBy: actor.id,
                    createdByName: actor.name,
                },
                select: { id: true, points: true, effectiveFrom: true, createdAt: true },
            });
            // 最初の点数の行は item_created の points に入っているので、rate_added は書かない
            await tx.evaluationPointLog.create({
                data: {
                    action: 'item_created',
                    actorId: actor.id,
                    actorName: actor.name,
                    itemId: item.id,
                    detail: { name: item.name, description: item.description, inputBy: item.inputBy, points: rate.points },
                },
            });
            return { item, rate };
        });

        const rates = [{
            id: created.rate.id,
            points: created.rate.points,
            effectiveFrom: today,
            createdAt: created.rate.createdAt.toISOString(),
        }];
        return NextResponse.json({ item: toItemResponse(created.item, rates, 0, today) }, { status: 201, ...NO_STORE });
    } catch (err) {
        return serverErrorResponse('評価ポイントの項目の追加', err);
    }
}
