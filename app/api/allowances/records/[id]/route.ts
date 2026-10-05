/**
 * 手当: 記録1件の取り消し・金額を手で直す（docs/指示書_大規模手当.md の 6-3。共通の決まりは 6-0）。
 *
 *   DELETE /api/allowances/records/[id]   admin・manager
 *   PATCH  /api/allowances/records/[id]   admin だけ（kei 決定 2026-10-05）
 *          body: { amount: number, note?: string | null }   金額を手で直す（note を省いたら、今のメモのまま）
 *             or { resetAmount: true }                       手で直した金額を、その日付の単価に戻す
 *
 * 取り消してよいか・直してよいか（締めた月でないか・権限があるか）は、lib/allowancesServer.ts の
 * removeAllowanceRecord()・editAllowanceRecordAmount()・resetAllowanceRecordAmount() が、鍵を取ったあとで確かめる
 * （締めるのと同時に取り消される・直されることが無い）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    ALLOWANCE_AMOUNT_MAX,
    ALLOWANCE_AMOUNT_MIN,
    ALLOWANCE_CLOSED_MESSAGE,
    ALLOWANCE_NOTE_MAX,
    ALLOWANCE_NO_RATE_MESSAGE,
    isAllowanceAdmin,
    isAllowanceManager,
    isValidAmount,
} from '@/lib/allowances';
import { actorOf, editAllowanceRecordAmount, removeAllowanceRecord, resetAllowanceRecordAmount } from '@/lib/allowancesServer';
import { NO_STORE, UNKNOWN_USER_NAME, loadUserNames, toAllowanceRecordResponse } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const result = await removeAllowanceRecord(actor, params.id);
        if (result === 'not_found') return notFoundResponse('記録');
        if (result === 'closed') return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);
        // 管理者・マネージャーが取り消せないのは、確定した自分の分だけ（canRemoveRecord）
        if (result === 'forbidden') return errorResponse('自分の分の記録は、自分では取り消せません（ほかの管理者・マネージャーに頼んでください）', 403);
        if (result === 'changed') return errorResponse('記録の状態が変わっています。画面を読み直してください', 400);

        return NextResponse.json({ ok: true }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の記録の取り消し', err);
    }
}

// ================================================================ PATCH

const FORBIDDEN_SELF_MESSAGE = '自分の分の金額は、自分では直せません（ほかの管理者に頼んでください）';
const AMOUNT_MESSAGE = `金額は ${ALLOWANCE_AMOUNT_MIN}〜${ALLOWANCE_AMOUNT_MAX} の整数で入れてください`;
const NOTE_MESSAGE = `メモは${ALLOWANCE_NOTE_MAX}字までの文字で入れてください`;
const NOT_EDITED_MESSAGE = 'この記録の金額は、手で直していません（画面を読み直してください）';

type PatchBody =
    | { kind: 'edit'; amount: unknown; note: unknown; hasNote: boolean }
    | { kind: 'reset' };

/**
 * body の形を見る（中身の範囲は、このあとで見る）。
 *  - { resetAmount: true } … 単価に戻す（amount・note を一緒に送ったら、形が違う）
 *  - { amount, note? }     … 金額を直す
 * どちらでもなければ null
 */
function parsePatchBody(value: unknown): PatchBody | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    if ('resetAmount' in body) {
        if (body.resetAmount !== true || 'amount' in body || 'note' in body) return null;
        return { kind: 'reset' };
    }
    if (!('amount' in body)) return null;
    return { kind: 'edit', amount: body.amount, note: body.note, hasNote: 'note' in body && body.note !== undefined };
}

/** メモ: 前後の空白を取って ALLOWANCE_NOTE_MAX 字まで。空・null は null。文字列でも null でもない・字数の外は { ok: false } */
function parseNote(value: unknown): { ok: true; value: string | null } | { ok: false } {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    if (trimmed.length > ALLOWANCE_NOTE_MAX) return { ok: false };
    return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        // 金額を直せるのは管理者だけ（マネージャー・職長は直せない）
        if (!isAllowanceAdmin(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = parsePatchBody(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');

        let result;
        if (body.kind === 'reset') {
            result = await resetAllowanceRecordAmount(actor, params.id);
        } else {
            if (!isValidAmount(body.amount)) return validationErrorResponse(AMOUNT_MESSAGE);
            let note: string | null | undefined;
            if (body.hasNote) {
                const parsed = parseNote(body.note);
                if (!parsed.ok) return validationErrorResponse(NOTE_MESSAGE);
                note = parsed.value;
            }
            result = await editAllowanceRecordAmount(actor, params.id, { amount: body.amount, note });
        }

        if (result === 'not_found') return notFoundResponse('記録');
        if (result === 'closed') return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);
        // 管理者が直せないのは、自分の分だけ（canEditRecordAmount）
        if (result === 'forbidden') return errorResponse(FORBIDDEN_SELF_MESSAGE, 403);
        if (result === 'no_rate') return errorResponse(ALLOWANCE_NO_RATE_MESSAGE, 400);
        if (result === 'not_edited') return errorResponse(NOT_EDITED_MESSAGE, 400);

        // 鍵を取ったあとで「締めていない」を確かめて書いたので、その月は締めていない
        const record = result.record;
        const names = await loadUserNames([record.userId]);
        return NextResponse.json(
            { record: toAllowanceRecordResponse(record, names.get(record.userId) ?? UNKNOWN_USER_NAME, actor, new Set()) },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('手当の記録の金額の保存', err);
    }
}
