/**
 * 手当: 手当の金額の履歴（docs/指示書_大規模手当.md の 6-1。共通の決まりは 6-0）。
 *
 *   GET  /api/allowances/items/[id]/rates   金額の履歴（適用開始日の新しい順）。admin・manager
 *   POST /api/allowances/items/[id]/rates   { foremanAmount, memberAmount, effectiveFrom } 行を足すだけ（追記のみ）。admin
 *
 * 適用開始日は、今日以降（予約）のほか、過去の日付も選べる（さかのぼった変更・打ちまちがいの直し）。
 * ただし、手当の始まりの日より前と、その日の月からあとに締めた月があるときは足せない（lib/allowances.ts の checkCanAddRate）。
 * 適用開始日が今日以前の行を足すと、その日からあとの、すでに付いている記録の金額も新しい金額になる
 * （書くのは lib/allowancesServer.ts の addAllowanceRate() だけ。鍵 → 確かめる → 足す → 記録を合わせる → 履歴）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    ALLOWANCE_AMOUNT_MAX,
    ALLOWANCE_AMOUNT_MIN,
    allowanceRateStateOf,
    dateKeyToDate,
    isAllowanceAdmin,
    isAllowanceManager,
    isAllowanceRateReplaced,
    isValidAmount,
    todayJstDateKey,
    type AllowanceRateLike,
    type AllowanceRateState,
} from '@/lib/allowances';
import { actorOf, addAllowanceRate, toAllowanceRateLike } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';
import { asObject } from '../../_shared';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

interface RateResponse {
    id: string;
    foremanAmount: number;
    memberAmount: number;
    effectiveFrom: string;
    createdByName: string;
    createdAt: string;
    /** upcoming = 予約（適用開始日が今日より後）／current = 今の金額／past = 以前 */
    state: AllowanceRateState;
    /** true = 同じ適用開始日で、あとから入れた行がある（この行は使われない） */
    replaced: boolean;
}

function toRateResponse(like: AllowanceRateLike, createdByName: string, rates: readonly AllowanceRateLike[], todayKey: string): RateResponse {
    return {
        id: like.id,
        foremanAmount: like.foremanAmount,
        memberAmount: like.memberAmount,
        effectiveFrom: like.effectiveFrom,
        createdByName,
        createdAt: like.createdAt,
        state: allowanceRateStateOf(like, rates, todayKey),
        replaced: isAllowanceRateReplaced(like, rates),
    };
}

// ================================================================ GET

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const item = await prisma.allowanceItem.findUnique({ where: { id: params.id }, select: { id: true } });
        if (!item) return notFoundResponse('手当');

        // createdByName が要るので、loadAllowanceRatesByItemId は使わずにここで引く
        const rows = await prisma.allowanceRate.findMany({
            where: { itemId: item.id },
            // 適用開始日の新しい順（同じ日は入れた日時の新しい順）
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdByName: true, createdAt: true },
        });

        const today = todayJstDateKey();
        const likes = rows.map(toAllowanceRateLike);
        // 応答は、金額の行の配列そのもの（評価ポイントの GET /items/[id]/rates と同じ）
        return NextResponse.json(rows.map((r, i) => toRateResponse(likes[i], r.createdByName, likes, today)), NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の金額の履歴の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形
        const body = asObject(await req.json().catch(() => null));
        if (!body || typeof body.effectiveFrom !== 'string') return validationErrorResponse('入力が不正です');
        const { foremanAmount, memberAmount } = body;
        if (!isValidAmount(foremanAmount) || !isValidAmount(memberAmount)) {
            return validationErrorResponse(`金額は ${ALLOWANCE_AMOUNT_MIN}〜${ALLOWANCE_AMOUNT_MAX} の整数で入れてください`);
        }
        const effectiveFromKey = body.effectiveFrom;
        if (!dateKeyToDate(effectiveFromKey)) return validationErrorResponse('日付が不正です');

        // ---- 保存（鍵 → 足してよいかを確かめる → 足す → すでに付いている記録を合わせる → 履歴）
        const result = await addAllowanceRate(actor, params.id, { foremanAmount, memberAmount, effectiveFromKey });
        if (!result.ok) {
            if (result.reason === 'not_found') return notFoundResponse('手当');
            if (result.reason === 'before_start') {
                return errorResponse(
                    result.startDate
                        ? `適用開始日は、手当の始まりの日（${result.startDate}）以降にしてください`
                        : '適用開始日は、今日以降にしてください',
                    400,
                );
            }
            return errorResponse(`${result.month} は締めてあります。締めを外してから、金額を変えてください`, 400);
        }

        return NextResponse.json(
            {
                rate: toRateResponse(toAllowanceRateLike(result.rate), result.rate.createdByName, result.rates, result.todayKey),
                // すでに付いていた記録のうち、金額が変わった件数
                repriced: result.repriced,
            },
            { status: 201, ...NO_STORE },
        );
    } catch (err) {
        return serverErrorResponse('手当の金額の変更', err);
    }
}
