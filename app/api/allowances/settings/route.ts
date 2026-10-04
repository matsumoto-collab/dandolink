/**
 * 手当: 公開の設定（docs/指示書_大規模手当.md の 6-7。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/settings   admin。{ showToMembers, memberNotice }
 *   PUT /api/allowances/settings   admin。body: { showToMembers: boolean, memberNotice?: string | null }
 *       注意書きは前後の空白を取って 200字まで・空と null は「注意書きなし」。
 *       memberNotice を省いたときは、今の注意書きをそのまま残す（オン／オフだけを送っても、注意書きは消えない）。
 *       行が無ければ作る（upsert）。変わったときだけ、同じトランザクションで AllowanceLog に setting_updated を書く。
 *
 * だれが何をできるかは lib/allowances.ts の関数で決める（ここにロールの文字列を書かない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { prisma } from '@/lib/prisma';
import { ALLOWANCE_NOTE_MAX, isAllowanceAdmin } from '@/lib/allowances';
import {
    ALLOWANCE_SETTING_ID,
    ALLOWANCE_TX_OPTIONS,
    actorOf,
    getAllowanceSetting,
    lockAllowanceWrites,
    type AllowanceSettingValue,
} from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

/** 注意書き: 前後の空白を取って max 字まで。空・null は null。文字列でも null でもない・字数の外は { ok: false } */
function parseNotice(value: unknown): { ok: true; value: string | null } | { ok: false } {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    if (trimmed.length > ALLOWANCE_NOTE_MAX) return { ok: false };
    return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

// ================================================================ GET

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        const setting = await getAllowanceSetting();
        return NextResponse.json({ showToMembers: setting.showToMembers, memberNotice: setting.memberNotice }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の公開の設定の取得', err);
    }
}

// ================================================================ PUT

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const raw: unknown = await req.json().catch(() => null);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return validationErrorResponse('入力が不正です');
        const body = raw as Record<string, unknown>;
        const { showToMembers } = body;
        if (typeof showToMembers !== 'boolean') return validationErrorResponse('入力が不正です');
        // memberNotice が無い（省いた）ときは、今の注意書きを残す
        const noticeGiven = body.memberNotice !== undefined;
        const notice = noticeGiven ? parseNotice(body.memberNotice) : null;
        if (notice && !notice.ok) return validationErrorResponse(`注意書きは${ALLOWANCE_NOTE_MAX}字までの文字で入れてください`);

        // ---- 保存（鍵 → 今の行を読む → 変わっていれば書く → 履歴）
        const saved = await prisma.$transaction(async (tx) => {
            await lockAllowanceWrites(tx);
            const row = await tx.allowanceSetting.findUnique({
                where: { id: ALLOWANCE_SETTING_ID },
                select: { showToMembers: true, memberNotice: true },
            });
            const before: AllowanceSettingValue = row
                ? { showToMembers: row.showToMembers === true, memberNotice: row.memberNotice ?? null }
                : { showToMembers: false, memberNotice: null };
            const after: AllowanceSettingValue = {
                showToMembers,
                memberNotice: notice && notice.ok ? notice.value : before.memberNotice,
            };
            // 行があって、中身が同じなら、書かない（履歴も書かない＝変わった分だけ）
            if (row && before.showToMembers === after.showToMembers && before.memberNotice === after.memberNotice) {
                return before;
            }
            await tx.allowanceSetting.upsert({
                where: { id: ALLOWANCE_SETTING_ID },
                create: { id: ALLOWANCE_SETTING_ID, ...after, updatedBy: actor.id },
                update: { ...after, updatedBy: actor.id },
                select: { id: true },
            });
            await tx.allowanceLog.create({
                data: {
                    action: 'setting_updated',
                    actorId: actor.id,
                    actorName: actor.name,
                    detail: { before: { ...before }, after: { ...after } },
                },
            });
            return after;
        }, ALLOWANCE_TX_OPTIONS);

        return NextResponse.json({ showToMembers: saved.showToMembers, memberNotice: saved.memberNotice }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の公開の設定の保存', err);
    }
}
