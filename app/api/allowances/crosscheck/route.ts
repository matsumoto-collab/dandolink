/**
 * 手当: 手配と見比べる（docs/指示書_大規模手当.md の 6-5。共通の決まりは 6-0）。
 *
 *   GET  /api/allowances/crosscheck?month=YYYY-MM          admin・manager
 *        手当ごとに、手配と出勤簿から「付くはずの人と日」を作って、実際の記録と見比べた結果を返す:
 *          missing  … 付くはずなのに、記録が無い（押し忘れ）
 *          extra    … 記録はあるが、手配と出勤簿からは付くはずでない（付けすぎ）
 *          mismatch … 記録はあるが、職長／職長以外が手配と違う
 *          unworked … 手配には入っているが、出勤簿が「働いた」になっていない（記録の有無は問わない。参考）
 *          people   … 人ごとの「手配から数えた日数」と「記録の日数」（実際に払った分との答え合わせ用）
 *          sites    … 対象として数えた現場（案件）と日数（「どの現場が対象になっているか」を確かめる用）
 *   POST /api/allowances/crosscheck   body: { itemId, month, keys: string[] }   admin・manager
 *        missing の中から選んだ分（keys = missing[].key）を、まとめて付ける。
 *        付けてよい相手かは、サーバーがもう一度 missing を作り直して決める（画面が送った人・日・区分をそのまま信じない）。
 *
 * 見比べ方の決まりは lib/allowances.ts（buildExpectedEntries・diffExpectedAndRecords）、
 * DB の読み方は lib/allowancesServer.ts（loadAllowanceCrosscheck）。読むだけ（出勤簿・手配は SELECT のみ）。
 * 記録を書くのは addAllowanceRecords() だけ（鍵 → 締めの確かめ → 入れる → 履歴）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import {
    ALLOWANCE_BULK_MAX,
    ALLOWANCE_CLOSED_MESSAGE,
    ALLOWANCE_INACTIVE_MESSAGE,
    amountOf,
    entryKey,
    isAllowanceManager,
    isFutureDateKey,
    isValidMonthKey,
    resolveAllowanceRateAt,
    type AllowancePayRole,
    type AllowanceStatus,
    type CrosscheckExtraReason,
} from '@/lib/allowances';
import {
    actorOf,
    addAllowanceRecords,
    isAllowanceMonthClosed,
    loadAllowanceCrosscheck,
    type AllowanceCrosscheck,
    type CrosscheckSite,
} from '@/lib/allowancesServer';
import { NO_STORE, UNKNOWN_USER_NAME, compareUsersStable } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------- 応答の形

interface MissingRow {
    /** まとめて付けるときに送る鍵（人と日） */
    key: string;
    userId: string;
    userName: string;
    date: string;
    payRole: AllowancePayRole;
    /** 付けたときの金額（その日付に有効な金額） */
    amount: number;
    /** 操作している人自身の分か（付けると確認待ちになる） */
    isSelf: boolean;
}

interface RecordRow {
    recordId: string;
    userId: string;
    userName: string;
    date: string;
    payRole: AllowancePayRole;
    amount: number;
    status: AllowanceStatus;
    createdByName: string;
}

interface CrosscheckItemResponse {
    itemId: string;
    itemName: string;
    isActive: boolean;
    constructionContent: string;
    /** 手配と出勤簿から付くはずの件数（人×日） */
    expectedCount: number;
    /** その月の記録の件数（確認待ちも含む） */
    recordCount: number;
    /**
     * 対象として数えた現場（日数の多い順）。
     * 0件 = この月に、数える対象になった手配が無い（対象の工事内容の現場の手配が無い・手当が始まる前の月・先の日付だけ・金額の行が無い、のどれか）
     */
    sites: CrosscheckSite[];
    missing: MissingRow[];
    /** reason: no_assignment = 対象の現場の手配に入っていない ／ not_worked = 出勤簿が「働いた」でない ／ not_eligible = 今は手当の対象外の人 */
    extra: (RecordRow & { reason: CrosscheckExtraReason })[];
    mismatch: (RecordRow & { expectedPayRole: AllowancePayRole })[];
    unworked: { userId: string; userName: string; date: string; payRole: AllowancePayRole; attendanceStatus: string | null }[];
    /**
     * 人ごとの日数。expected* = 手配と出勤簿から付くはずの日数、recorded* = 記録の日数（確認待ちも含む）。
     * どちらかが1日以上ある人だけ。人の並びは、評価ポイントの一覧と同じ
     */
    people: {
        userId: string;
        userName: string;
        expectedForemanDays: number;
        expectedMemberDays: number;
        recordedForemanDays: number;
        recordedMemberDays: number;
    }[];
}

/** 人ごとの「手配から数えた日数」と「記録の日数」 */
function buildPeople(check: AllowanceCrosscheck): CrosscheckItemResponse['people'] {
    const byUser = new Map<string, { expectedForemanDays: number; expectedMemberDays: number; recordedForemanDays: number; recordedMemberDays: number }>();
    const cell = (userId: string) => {
        let c = byUser.get(userId);
        if (!c) {
            c = { expectedForemanDays: 0, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 0 };
            byUser.set(userId, c);
        }
        return c;
    };
    for (const e of check.expected) {
        if (e.payRole === 'foreman') cell(e.userId).expectedForemanDays += 1;
        else cell(e.userId).expectedMemberDays += 1;
    }
    for (const r of check.records) {
        if (r.payRole === 'foreman') cell(r.userId).recordedForemanDays += 1;
        else cell(r.userId).recordedMemberDays += 1;
    }
    return Array.from(byUser.entries())
        .map(([userId, c]) => {
            const u = check.users.get(userId);
            return { userId, displayName: u?.displayName ?? UNKNOWN_USER_NAME, dispatchSortOrder: u?.dispatchSortOrder ?? null, ...c };
        })
        .sort(compareUsersStable)
        .map(({ userId, displayName, expectedForemanDays, expectedMemberDays, recordedForemanDays, recordedMemberDays }) => ({
            userId, userName: displayName, expectedForemanDays, expectedMemberDays, recordedForemanDays, recordedMemberDays,
        }));
}

function toItemResponse(
    item: { id: string; name: string; isActive: boolean; constructionContent: string },
    check: AllowanceCrosscheck,
    operatorId: string,
): CrosscheckItemResponse {
    const nameOf = (userId: string) => check.users.get(userId)?.displayName ?? UNKNOWN_USER_NAME;
    const recordRow = (r: AllowanceCrosscheck['records'][number]): RecordRow => ({
        recordId: r.id, userId: r.userId, userName: nameOf(r.userId), date: r.date, payRole: r.payRole, amount: r.amount, status: r.status, createdByName: r.createdByName,
    });
    return {
        itemId: item.id,
        itemName: item.name,
        isActive: item.isActive,
        constructionContent: item.constructionContent,
        expectedCount: check.expected.length,
        recordCount: check.records.length,
        sites: check.sites,
        missing: check.diff.missing.flatMap((e) => {
            // 付くはずの日は、その日付に有効な金額がある日だけ（loadAllowanceCrosscheck が、金額の無い日の手配を見ない）
            const rate = resolveAllowanceRateAt(check.rates, e.date);
            if (!rate) return [];
            return [{
                key: entryKey(e.userId, e.date),
                userId: e.userId,
                userName: nameOf(e.userId),
                date: e.date,
                payRole: e.payRole,
                amount: amountOf(rate, e.payRole),
                isSelf: e.userId === operatorId,
            }];
        }),
        extra: check.diff.extra.map((x) => ({ ...recordRow(x.record), reason: x.reason })),
        mismatch: check.diff.mismatch.map((x) => ({ ...recordRow(x.record), expectedPayRole: x.expectedPayRole })),
        unworked: check.unworked.map((e) => ({ userId: e.userId, userName: nameOf(e.userId), date: e.date, payRole: e.payRole, attendanceStatus: e.attendanceStatus })),
        people: buildPeople(check),
    };
}

// ================================================================ GET

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const month = new URL(req.url).searchParams.get('month');
        if (month === null) return validationErrorResponse('入力が不正です');
        if (!isValidMonthKey(month)) return validationErrorResponse('月が不正です');

        const [items, closed] = await Promise.all([
            prisma.allowanceItem.findMany({
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                select: { id: true, name: true, isActive: true, constructionContent: true },
            }),
            isAllowanceMonthClosed(month),
        ]);
        const result: CrosscheckItemResponse[] = [];
        for (const item of items) {
            const check = await loadAllowanceCrosscheck(item, month);
            if (!check) continue; // 月の形は上で確かめてあるので、ここには来ない
            // 使っていない手当も返す（「使う」にする前に、手配から数えた日数を見られるように。まとめて付けるのは、使用中の手当だけ）
            result.push(toItemResponse(item, check, actor.id));
        }

        return NextResponse.json({ month, closed, items: result }, NO_STORE);
    } catch (err) {
        return serverErrorResponse('手配との見比べの取得', err);
    }
}

// ================================================================ POST

interface BulkBody {
    itemId: string;
    month: string;
    keys: string[];
}

/** { itemId, month, keys } の形のときだけ、重なりを除いた中身を返す。違えば null（月の形は別に確かめる） */
function parseBulkBody(value: unknown): BulkBody | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { itemId, month, keys } = value as Record<string, unknown>;
    if (typeof itemId !== 'string' || !itemId || typeof month !== 'string' || !Array.isArray(keys)) return null;
    if (keys.length === 0 || keys.length > ALLOWANCE_BULK_MAX) return null;
    if (!keys.every((k): k is string => typeof k === 'string' && k.length > 0)) return null;
    return { itemId, month, keys: Array.from(new Set(keys as string[])) };
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const body = parseBulkBody(await req.json().catch(() => null));
        if (!body) return validationErrorResponse('入力が不正です');
        if (!isValidMonthKey(body.month)) return validationErrorResponse('月が不正です');

        const item = await prisma.allowanceItem.findUnique({
            where: { id: body.itemId },
            select: { id: true, name: true, isActive: true, constructionContent: true },
        });
        if (!item) return notFoundResponse('手当');
        if (!item.isActive) return errorResponse(ALLOWANCE_INACTIVE_MESSAGE, 400);

        // 先に知らせる（最後の確かめは、addAllowanceRecords が鍵を取ったあとでもう一度行う）
        if (await isAllowanceMonthClosed(body.month)) return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);

        // 付けてよい相手は、サーバーが作り直した「付くはずなのに記録が無い」人と日だけ。区分（職長／職長以外）も手配から決める
        const check = await loadAllowanceCrosscheck(item, body.month);
        if (!check) return validationErrorResponse('月が不正です');
        const missingByKey = new Map(check.diff.missing.map((e) => [entryKey(e.userId, e.date), e]));
        const entries = body.keys
            .map((key) => missingByKey.get(key))
            .filter((e): e is NonNullable<typeof e> => e !== undefined && !isFutureDateKey(e.date))
            .map((e) => ({ userId: e.userId, dateKey: e.date, payRole: e.payRole }));

        if (entries.length === 0) {
            return NextResponse.json({ added: 0, pending: 0, skipped: body.keys.length }, NO_STORE);
        }

        const result = await addAllowanceRecords({ actor, item: { id: item.id, name: item.name }, entries, source: 'bulk' });
        // 読んでから入れるまでのあいだに、月が締められた
        if (result.added.length === 0 && result.closedCount > 0) return errorResponse(ALLOWANCE_CLOSED_MESSAGE, 400);

        return NextResponse.json(
            {
                added: result.added.length,
                // 入った分のうち、確認待ちになった件数（操作している人自身の分）
                pending: result.added.filter((r) => r.status === 'pending').length,
                // 入らなかった件数（もう付いていた・付くはずの一覧に無い など）
                skipped: body.keys.length - result.added.length,
            },
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('手当をまとめて付ける処理', err);
    }
}
