/**
 * 評価ポイント: DB を読む側の共通部品（API の route から呼ぶ）。
 *
 * 決まりごと（だれが何をできるか・どの点数を使うか）は lib/evaluationPoints.ts に書いてある。
 * ここには、Prisma で「決まりごとの関数に渡す材料」を読む小さな関数だけを置く。
 *
 * getEvaluationPointSetting・resolveAccessMode（docs/指示書_評価ポイント.md の 5-2 の 3・4）は Phase 4 で、ファイルの末尾に足した。
 */
import { prisma } from '@/lib/prisma';
import { parseJsonField } from '@/lib/api/utils';
import { dateKeyToDate, dateToDateKey, type PointRateLike } from '@/lib/evaluationPoints';
import { isEvaluationPointManager, isEvaluationPointMemberRole } from '@/lib/evaluationPoints';

export interface AttendanceMember {
    id: string;
    displayName: string;
    /** DB の値のまま（大文字が混ざる）。判定は必ず lib/evaluationPoints.ts の関数を通すこと */
    role: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * その職長・その日の「出勤簿入力」に並ぶ人を返す。
 *
 * app/api/attendance/members/route.ts と同じ決まりにしてある（あちらは書き換えない。出勤簿の動きを変えないため）:
 *   日本時間のその日（Date.UTC(y, m - 1, d, -9) から24時間）にある、
 *   assignedEmployeeId = foremanId・isBackfilled: false の配置の confirmedWorkerIds を集め、
 *   職長本人を足し、isActive: true のユーザーだけにする。
 * 2つが食い違わないことは、テストで「両方が findMany に渡した where が同じ」ことを比べて確かめる。
 *
 * 返す順番は決めていない（画面は userId で突き合わせる）。
 */
export async function getAttendanceMembers(foremanId: string, dateKey: string): Promise<AttendanceMember[]> {
    // 日付の形は、呼ぶ側（route）が先に確かめて 400 を返す。
    // ここに形の違う日付が来たら例外にする（黙って空の配列を返すと、確かめ忘れに気づけない）
    if (!dateKeyToDate(dateKey)) throw new Error(`getAttendanceMembers: 日付の形が違います: ${String(dateKey)}`);

    // ProjectAssignment.date は「JST 0時 = UTC 前日15時」で入っている（時刻つき）。
    // UTC 0時から範囲を取ると1日ずれるので、JST 0時（時を -9 にして Date.UTC に渡す）から24時間で取る
    const [y, m, d] = dateKey.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
    const end = new Date(start.getTime() + DAY_MS);

    const assignments = await prisma.projectAssignment.findMany({
        where: {
            assignedEmployeeId: foremanId,
            date: { gte: start, lt: end },
            isBackfilled: false,
        },
        select: { confirmedWorkerIds: true },
    });

    const userIds = new Set<string>();
    userIds.add(foremanId); // 職長本人
    for (const a of assignments) {
        // confirmedWorkerIds は JSON の文字列。既存の route と同じ parseJsonField で読み、空の ID は捨てる
        const ids = parseJsonField<string[]>(a.confirmedWorkerIds, []);
        for (const id of ids) {
            if (id) userIds.add(id);
        }
    }

    return prisma.user.findMany({
        where: { id: { in: Array.from(userIds) }, isActive: true },
        select: { id: true, displayName: true, role: true },
    });
}

/**
 * 項目ごとの点数の履歴を返す。
 * effectiveFrom は 'YYYY-MM-DD'、createdAt は ISO 文字列にしてあるので、resolveRateAt() にそのまま渡せる。
 * 点数の行が無い項目は、空の配列で入れる（呼ぶ側が get() の undefined を気にしなくて済むように）。
 */
export async function loadRatesByItemId(itemIds: readonly string[]): Promise<Map<string, PointRateLike[]>> {
    const result = new Map<string, PointRateLike[]>();
    for (const itemId of itemIds) result.set(itemId, []);
    if (result.size === 0) return result;

    const rows = await prisma.evaluationPointRate.findMany({
        where: { itemId: { in: Array.from(result.keys()) } },
        select: { id: true, itemId: true, points: true, effectiveFrom: true, createdAt: true },
    });
    for (const row of rows) {
        result.get(row.itemId)?.push({
            id: row.id,
            points: row.points,
            effectiveFrom: dateToDateKey(row.effectiveFrom),
            createdAt: row.createdAt.toISOString(),
        });
    }
    return result;
}

/** 操作している人。id・role は PointOperator として、そのまま canRemoveRecord() などに渡せる */
export interface PointActor {
    id: string;
    role: string;
    /** 名前の写し（createdByName・confirmedByName・actorName）に使う。表示名。無ければ username */
    name: string;
}

/**
 * requireAuth() が返す session のうち、actorOf() が使う項目。
 * next-auth の Session をそのまま渡せるように、どの項目も「無いことがある」形で受ける。
 */
export interface SessionLike {
    user: {
        id?: string | null;
        role?: string | null;
        name?: string | null;
        username?: string | null;
    };
}

/**
 * 操作している人を、session から取り出す。
 * session.user.role は、ログイン時に小文字へそろえてある。
 * id・role が入っていない session のときは空文字にする
 * （空文字のロールは、lib/evaluationPoints.ts のどの判定も通らない＝ API は 403 で断る）。
 */
export function actorOf(session: SessionLike): PointActor {
    return {
        id: session.user.id ?? '',
        role: session.user.role ?? '',
        name: session.user.name ?? session.user.username ?? '',
    };
}

// ---------------------------------------------------------------- 公開の設定（Phase 4）

/** 公開の設定の行の id（1行だけ。マイグレーションで初期行を入れてある） */
export const EVALUATION_POINT_SETTING_ID = 'default';

export interface EvaluationPointSettingValue {
    /** true = 本人（職長・作業員）に自分の点数と内訳を見せる */
    showToMembers: boolean;
    /** 本人の画面の上に出す注意書き */
    memberNotice: string | null;
}

/**
 * 公開の設定を返す。行が無ければ「見せない・注意書きなし」
 * （マイグレーションで初期行を入れてあるが、無くても本人に見えてしまう側には倒さない）。
 */
export async function getEvaluationPointSetting(): Promise<EvaluationPointSettingValue> {
    const row = await prisma.evaluationPointSetting.findUnique({
        where: { id: EVALUATION_POINT_SETTING_ID },
        select: { showToMembers: true, memberNotice: true },
    });
    if (!row) return { showToMembers: false, memberNotice: null };
    return { showToMembers: row.showToMembers === true, memberNotice: row.memberNotice ?? null };
}

/**
 * 「評価ポイント」の画面をどう見せるか。
 *   'manager' = 全員の一覧（admin・manager）
 *   'member'  = 自分の点数と内訳だけ（worker・foreman1・foreman2 で、公開の設定がオンのとき）
 *   'none'    = 見せない（それ以外）
 */
export type EvaluationPointAccessMode = 'manager' | 'member' | 'none';

/**
 * ロールから見せ方を決める。ロールの判定は lib/evaluationPoints.ts の関数で行う（小文字にそろえて比べる）。
 * 公開の設定を読むのは、職長・作業員のときだけ。
 */
export async function resolveAccessMode(role: string | null | undefined): Promise<EvaluationPointAccessMode> {
    if (isEvaluationPointManager(role)) return 'manager';
    if (!isEvaluationPointMemberRole(role)) return 'none';
    const setting = await getEvaluationPointSetting();
    return setting.showToMembers ? 'member' : 'none';
}
