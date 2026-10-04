/**
 * 手当: 記録の一覧・追加・確認（docs/指示書_大規模手当.md の 6-3。共通の決まりは 6-0）。
 *
 *   GET   /api/allowances/records?month=YYYY-MM&userId=&status=
 *         月は必須。ただし status=pending のときだけ月を省ける（省いたら全部の月の確認待ち）
 *   POST  /api/allowances/records   body: { userId, date, itemId, payRole, note? }   記録を1件付ける
 *   PATCH /api/allowances/records   body: { action: 'confirm', ids: string[] }       確認待ちを認める
 *
 * すべて admin・manager だけ。だれが何をできるか・どの金額を使うかは lib/allowances.ts の関数で決める。
 * 記録を書くのは lib/allowancesServer.ts の関数だけ（鍵 → 締めの確かめ → 書く → 履歴）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    ALLOWANCE_CLOSED_MESSAGE,
    ALLOWANCE_INACTIVE_MESSAGE,
    ALLOWANCE_NOTE_MAX,
    ALLOWANCE_NO_RATE_MESSAGE,
    dateKeyToDate,
    dateToDateKey,
    isAllowanceEligibleRole,
    isAllowanceManager,
    isAllowancePayRole,
    isFutureDateKey,
    monthKeyOf,
    monthRangeOf,
} from '@/lib/allowances';
import { actorOf, addAllowanceRecords, confirmAllowanceRecords, loadClosedMonths } from '@/lib/allowancesServer';
import { ALLOWANCE_RECORD_SELECT, NO_STORE, UNKNOWN_USER_NAME, loadUserNames, toAllowanceRecordResponse } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

const DUPLICATE_MESSAGE = 'その日のその手当は、すでに付いています';

/** 1回の「まとめて認める」で受け付ける件数の上限（画面の確認待ちの一覧より十分に大きい数） */
const CONFIRM_IDS_MAX = 1000;

/** body が JSON のオブジェクト（配列でない）なら、その中身を返す。違えば null */
function asObject(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/** メモ: 前後の空白を取って max 字まで。無い・空・null は null。文字列でも null でもない・字数の外は { ok: false } */
function parseNote(value: unknown): { ok: true; value: string | null } | { ok: false } {
    if (value === undefined || value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    if (trimmed.length > ALLOWANCE_NOTE_MAX) return { ok: false };
    return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const params = new URL(req.url).searchParams;
        const status = params.get('status');
        if (status !== null && status !== 'confirmed' && status !== 'pending') return validationErrorResponse('入力が不正です');
        const userId = params.get('userId');
        if (userId === '') return validationErrorResponse('入力が不正です');

        // 確認待ちが、表示している月の外に埋もれないように、status=pending のときだけ月を省ける
        const month = params.get('month');
        const range = month === null ? null : monthRangeOf(month);
        if (month === null && status !== 'pending') return validationErrorResponse('入力が不正です');
        if (month !== null && !range) return validationErrorResponse('月が不正です');

        const rows = await prisma.allowanceRecord.findMany({
            where: {
                ...(range ? { date: range.dateRange } : {}),
                ...(userId ? { userId } : {}),
                ...(status ? { status } : {}),
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            select: ALLOWANCE_RECORD_SELECT,
        });
        const [names, closedMonths] = await Promise.all([
            loadUserNames(rows.map((r) => r.userId)),
            loadClosedMonths(prisma, rows.map((r) => monthKeyOf(dateToDateKey(r.date)))),
        ]);

        return NextResponse.json(
            { records: rows.map((r) => toAllowanceRecordResponse(r, names.get(r.userId) ?? UNKNOWN_USER_NAME, actor, closedMonths)) },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('手当の記録の取得', err);
    }
}

// ================================================================ POST

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        // ---- 入力の形（JSON として読めない body・オブジェクトでない body も、ここで断る）
        const body = asObject(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        const { userId, date, itemId, payRole } = body;
        if (typeof userId !== 'string' || !userId || typeof date !== 'string' || typeof itemId !== 'string' || !itemId || !isAllowancePayRole(payRole)) {
            return validationErrorResponse('入力が不正です');
        }
        const note = parseNote(body.note);
        if (!note.ok) return validationErrorResponse(`メモは${ALLOWANCE_NOTE_MAX}字までの文字で入れてください`);

        // ---- 日付（形 → 先の日付）
        if (!dateKeyToDate(date)) return validationErrorResponse('日付が不正です');
        if (isFutureDateKey(date)) return errorResponse('先の日付には付けられません', 400);

        // ---- 対象の人（手当をもらえるロール。在籍かどうかは問わない＝辞めた人の、在籍中の日の分も付けられる）
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, role: true } });
        if (!user) return errorResponse('対象の人が見つかりません', 400);
        // user.role は DB の値（大文字が混ざる）。判定の関数が小文字にそろえて比べる
        if (!isAllowanceEligibleRole(user.role)) return errorResponse('手当の対象外の人です', 400);

        // ---- 手当（使用中のものだけ。対象の現場へ手配されているかは見ない＝手配に無い人・日も、管理者・マネージャーは付けられる）
        const item = await prisma.allowanceItem.findUnique({ where: { id: itemId }, select: { id: true, name: true, isActive: true } });
        if (!item) return notFoundResponse('手当');
        if (!item.isActive) return errorResponse(ALLOWANCE_INACTIVE_MESSAGE, 400);

        // ---- 保存（鍵 → 締めの確かめ → 入れる → 履歴）。自分に付けたら確認待ち
        const result = await addAllowanceRecords({
            actor,
            item: { id: item.id, name: item.name },
            entries: [{ userId, dateKey: date, payRole }],
            source: 'manual',
            note: note.value,
        });
        if (result.closedCount > 0) return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);
        if (result.noRateCount > 0) return errorResponse(ALLOWANCE_NO_RATE_MESSAGE, 400);
        if (result.added.length === 0) return errorResponse(DUPLICATE_MESSAGE, 400);

        // 入った直後なので、その月は締めていない
        return NextResponse.json(
            { record: toAllowanceRecordResponse(result.added[0], user.displayName, actor, new Set()) },
            { status: 201, ...NO_STORE },
        );
    } catch (err) {
        return serverErrorResponse('手当の記録の追加', err);
    }
}

// ================================================================ PATCH

/** { action: 'confirm', ids: string[] } のときだけ、重なりを除いた ids を返す。違えば null */
function parseConfirmBody(value: unknown): string[] | null {
    const body = asObject(value);
    if (!body || body.action !== 'confirm' || !Array.isArray(body.ids)) return null;
    if (body.ids.length > CONFIRM_IDS_MAX) return null;
    if (!body.ids.every((id): id is string => typeof id === 'string' && id.length > 0)) return null;
    return Array.from(new Set(body.ids as string[]));
}

export async function PATCH(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const ids = parseConfirmBody(await req.json().catch(() => null));
        if (!ids) return validationErrorResponse('入力が不正です');

        // 認めてよい記録だけを認める（自分の分・確定済み・締めた月の記録・無い ID は skipped に数える）
        const { confirmed, skipped } = await confirmAllowanceRecords(actor, ids);
        return NextResponse.json({ confirmed, skipped }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手当の記録の確認', err);
    }
}
