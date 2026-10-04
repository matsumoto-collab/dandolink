/**
 * 手当: 手当の種類1つ（docs/指示書_大規模手当.md の 6-1。共通の決まりは 6-0）。
 *
 *   PATCH /api/allowances/items/[id]   { name?, description?, isActive? } の指定されたものだけ直す。admin
 *
 * 対象の工事内容（constructionContent）は、ここでは直せない（手当の行と一緒に、マイグレーションで決める）。
 * 記録に写してある名前（itemName）は、名前を直しても変わらない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { ALLOWANCE_DESCRIPTION_MAX, ALLOWANCE_NAME_MAX, isAllowanceAdmin, todayJstDateKey } from '@/lib/allowances';
import { ALLOWANCE_TX_OPTIONS, actorOf, loadAllowanceRatesByItemId, lockAllowanceWrites } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';
import { asObject, parseName, parseOptionalText, toAllowanceItemResponse } from '../_shared';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

/** 直せる列 */
interface ItemPatch {
    name?: string;
    description?: string | null;
    isActive?: boolean;
}

const INVALID_MESSAGE = '入力が不正です';

/**
 * body から、指定された列だけを読む。
 * 形が違う列が1つでもあれば、その列の文言で断る。何も指定が無いときも断る。
 */
function parsePatchBody(body: Record<string, unknown> | null): { ok: true; patch: ItemPatch } | { ok: false; message: string } {
    if (!body) return { ok: false, message: INVALID_MESSAGE };
    const patch: ItemPatch = {};
    if (body.name !== undefined) {
        const name = parseName(body.name, ALLOWANCE_NAME_MAX);
        if (!name) return { ok: false, message: `名前は1〜${ALLOWANCE_NAME_MAX}字で入れてください` };
        patch.name = name;
    }
    if (body.description !== undefined) {
        const description = parseOptionalText(body.description, ALLOWANCE_DESCRIPTION_MAX);
        if (!description.ok) return { ok: false, message: `説明は${ALLOWANCE_DESCRIPTION_MAX}字までの文字で入れてください` };
        patch.description = description.value;
    }
    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') return { ok: false, message: INVALID_MESSAGE };
        patch.isActive = body.isActive;
    }
    if (Object.keys(patch).length === 0) return { ok: false, message: INVALID_MESSAGE };
    return { ok: true, patch };
}

const ITEM_SELECT = {
    id: true, name: true, description: true, constructionContent: true, isActive: true, sortOrder: true,
    _count: { select: { records: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const parsed = parsePatchBody(asObject(await req.json().catch(() => null)));
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        const { patch } = parsed;

        // ---- 保存（鍵 → 今の行を読む → 同じ名前が無いか → 変わった列だけ直す → 履歴）
        const result = await prisma.$transaction(async (tx) => {
            await lockAllowanceWrites(tx);
            const current = await tx.allowanceItem.findUnique({ where: { id: params.id }, select: ITEM_SELECT });
            if (!current) return { ok: false, reason: 'not_found' } as const;

            // 同じ名前の手当（使っていない手当も含めて比べる。自分自身は除く）
            if (patch.name !== undefined && patch.name !== current.name) {
                const sameName = await tx.allowanceItem.findFirst({
                    where: { name: patch.name, id: { not: current.id } },
                    select: { id: true },
                });
                if (sameName) return { ok: false, reason: 'same_name' } as const;
            }

            // 変わった列だけを直し、履歴にも変わった列だけを書く
            const before: Record<string, unknown> = {};
            const after: Record<string, unknown> = {};
            for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
                if (patch[key] !== current[key]) {
                    before[key] = current[key];
                    after[key] = patch[key];
                }
            }
            // 何も変わらなければ、書かない（履歴も書かない）
            if (Object.keys(after).length === 0) return { ok: true, item: current } as const;

            const row = await tx.allowanceItem.update({ where: { id: current.id }, data: after as ItemPatch, select: ITEM_SELECT });
            await tx.allowanceLog.create({
                data: {
                    action: 'item_updated',
                    actorId: actor.id,
                    actorName: actor.name,
                    itemId: current.id,
                    detail: { before, after } as Prisma.InputJsonObject,
                },
            });
            return { ok: true, item: row } as const;
        }, ALLOWANCE_TX_OPTIONS);

        if (!result.ok) {
            if (result.reason === 'not_found') return notFoundResponse('手当');
            return errorResponse('同じ名前の手当が、すでにあります', 400);
        }

        const updated = result.item;
        const ratesByItemId = await loadAllowanceRatesByItemId([updated.id]);
        return NextResponse.json(
            { item: toAllowanceItemResponse(updated, ratesByItemId.get(updated.id) ?? [], updated._count.records, todayJstDateKey()) },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('手当の種類の更新', err);
    }
}
