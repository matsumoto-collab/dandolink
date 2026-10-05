/**
 * 評価ポイント: 本人の点数と内訳（docs/指示書_評価ポイント.md の 6-4。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/me?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD   期間は必須
 *
 * だれ: resolveAccessMode() が 'manager' か 'member' の人。'none'（公開の設定がオフの職長・作業員など）は 403。
 * 返すのは、ログインしている本人の記録だけ。userId は必ずセッションから取る（クエリやボディで受け取らない）。
 * 付けた人の名前・メモは返さない。数字は summarizeRecords()（確認待ちは合計に入れない）。
 *
 * 本人が期間中にもらった「ありがとう」（lib/evaluationThanks.ts）も足す（1件も無ければ、今までと同じ応答）:
 *  - byItem に仮の項目（itemId '__thanks__'・「ありがとう」）。合計にも足す（確認待ちは無い。点数は行に写してある points）
 *  - records に1件ずつ（id 'thanks:<行の id>'・項目名「ありがとう（◯◯さんから）」＝送った人の名前・status 'confirmed'）。ひとことは返さない
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { dateToDateKey, summarizeRecords, toEvaluationPointStatus, type EvaluationPointStatus } from '@/lib/evaluationPoints';
import { actorOf, getEvaluationPointSetting, resolveAccessMode } from '@/lib/evaluationPointsServer';
import { NO_STORE, UNKNOWN_USER_NAME, loadUserNames, parsePeriodParams } from '@/lib/evaluationPointsReport';
import { THANKS_ITEM_NAME, THANKS_VIRTUAL_ITEM_ID } from '@/lib/evaluationThanks';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

/** 応答の形（画面側の型は components/EvaluationPoints/evaluationPointsClient.ts の MyPointsData） */
interface MyPointsResponse {
    startDate: string;
    endDate: string;
    /** 公開の設定の注意書き */
    notice: string | null;
    totalPoints: number;
    totalCount: number;
    pendingCount: number;
    /** 回数のある項目だけ（確定の記録）。点数の多い順。itemName は今の項目名 */
    byItem: { itemId: string; itemName: string; count: number; points: number }[];
    /** 日付の新しい順。itemName は記録に写してある名前 */
    records: { id: string; date: string; itemName: string; points: number; status: EvaluationPointStatus }[];
}

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        const mode = await resolveAccessMode(actor.role);
        if (mode === 'none' || !actor.id) return errorResponse('権限がありません', 403);

        const parsed = parsePeriodParams(new URL(req.url).searchParams);
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        if (!parsed.period) return validationErrorResponse('入力が不正です');
        const period = parsed.period;

        const [setting, rows, thanksRows] = await Promise.all([
            getEvaluationPointSetting(),
            prisma.evaluationPointRecord.findMany({
                // 本人の分だけ（セッションの ID）
                where: { userId: actor.id, date: period.range },
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
                select: { id: true, date: true, itemId: true, itemName: true, points: true, status: true },
            }),
            // 本人がもらった「ありがとう」（本人の分だけ＝セッションの ID）。ひとことは返さないので読まない
            prisma.evaluationPointThanks.findMany({
                where: { toUserId: actor.id, date: period.range },
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
                select: { id: true, fromUserId: true, date: true, points: true },
            }),
        ]);

        const records = rows.map((r) => ({
            id: r.id,
            date: dateToDateKey(r.date),
            itemId: r.itemId,
            itemName: r.itemName,
            points: r.points,
            status: toEvaluationPointStatus(r.status),
        }));
        const summary = summarizeRecords(records.map((r) => ({
            userId: actor.id, itemId: r.itemId, points: r.points, status: r.status,
        }))).get(actor.id);

        // 項目ごとの欄の名前は、今の項目名（項目が見つからなければ、記録に写してある名前）
        const byItemEntries = Object.entries(summary?.byItem ?? {}).filter(([, cell]) => cell.count > 0);
        const itemRows = byItemEntries.length === 0
            ? []
            : await prisma.evaluationPointItem.findMany({
                where: { id: { in: byItemEntries.map(([itemId]) => itemId) } },
                select: { id: true, name: true, sortOrder: true },
            });
        const itemById = new Map(itemRows.map((i) => [i.id, i]));
        const copiedName = new Map(records.map((r) => [r.itemId, r.itemName]));

        const byItemRows = byItemEntries.map(([itemId, cell]) => ({
            itemId,
            itemName: itemById.get(itemId)?.name ?? copiedName.get(itemId) ?? '',
            count: cell.count,
            points: cell.points,
            isThanks: 0,
            sortOrder: itemById.get(itemId)?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        }));

        // 「ありがとう」（確認待ちは無い＝全部が合計に入る。点数は行に写してある points の足し算）
        const thanksPoints = thanksRows.reduce((sum, r) => sum + r.points, 0);
        if (thanksRows.length > 0) {
            byItemRows.push({
                itemId: THANKS_VIRTUAL_ITEM_ID,
                itemName: THANKS_ITEM_NAME,
                count: thanksRows.length,
                points: thanksPoints,
                isThanks: 1,
                sortOrder: Number.MAX_SAFE_INTEGER,
            });
        }

        const byItem = byItemRows
            // 点数の多い順（同じ点数は、点数表の並び順。「ありがとう」は点数表の項目のあと）
            .sort((a, b) => b.points - a.points || a.isThanks - b.isThanks || a.sortOrder - b.sortOrder || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
            .map(({ itemId, itemName, count, points }) => ({ itemId, itemName, count, points }));

        // 付けた人の名前・メモは返さない（「ありがとう」だけは、送った人の名前を項目名に添える）
        const pointRecords: MyPointsResponse['records'] = records.map((r) => ({
            id: r.id, date: r.date, itemName: r.itemName, points: r.points, status: r.status,
        }));
        const senderNames = await loadUserNames(thanksRows.map((r) => r.fromUserId));
        const thanksRecords: MyPointsResponse['records'] = thanksRows.map((r) => ({
            id: `thanks:${r.id}`,
            date: dateToDateKey(r.date),
            itemName: `${THANKS_ITEM_NAME}（${senderNames.get(r.fromUserId) ?? UNKNOWN_USER_NAME}さんから）`,
            points: r.points,
            status: 'confirmed',
        }));
        // 日付の新しい順。同じ日の中は、点数表の記録が先・「ありがとう」が後（どちらも読んだ順のまま＝安定な並べ替え）
        const mergedRecords = thanksRecords.length === 0
            ? pointRecords
            : [...pointRecords, ...thanksRecords].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

        const body: MyPointsResponse = {
            startDate: period.startDate,
            endDate: period.endDate,
            notice: setting.memberNotice,
            totalPoints: (summary?.totalPoints ?? 0) + thanksPoints,
            totalCount: (summary?.totalCount ?? 0) + thanksRows.length,
            pendingCount: summary?.pendingCount ?? 0,
            byItem,
            records: mergedRecords,
        };
        return NextResponse.json(body, NO_STORE);
    } catch (err) {
        return serverErrorResponse('評価ポイントの取得', err);
    }
}
