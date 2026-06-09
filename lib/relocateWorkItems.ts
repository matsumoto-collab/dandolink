import { prisma } from '@/lib/prisma';
import { toJstDateOnly } from '@/lib/dateUtils';

/**
 * 配置(ProjectAssignment)を別日へリスケしたとき、旧日付の日報に残る作業明細(DailyReportWorkItem)を
 * 新日付の日報へ移送する（作業時間・作業者ごと一緒に動かす）。
 *
 * これをしないと旧日付に「孤児明細」が残り、原価エンジンが配置の明細を日付無関係に全合算するため
 * 人件費が二重計上される（2026-06-09 kei報告の根本原因）。
 *
 * 重複回避: 移送先(新日付・同じ職長)に既に同じ配置の明細があれば、旧明細は移送せず削除する。
 * JSTカレンダー日で比較し、同じ日なら何もしない。失敗してもリスケ自体は止めない想定（呼び出し側で try/catch）。
 */
export async function relocateAssignmentWorkItems(
    assignmentId: string,
    oldDate: Date,
    newDate: Date,
    actorUserId: string,
): Promise<void> {
    const newJst = toJstDateOnly(newDate);
    if (toJstDateOnly(oldDate).getTime() === newJst.getTime()) return; // 同じJST日なら移送不要

    const items = await prisma.dailyReportWorkItem.findMany({
        where: { assignmentId },
        select: { id: true, dailyReport: { select: { foremanId: true, date: true } } },
    });

    for (const wi of items) {
        if (!wi.dailyReport) continue;
        if (toJstDateOnly(wi.dailyReport.date).getTime() === newJst.getTime()) continue; // すでに新日付にある

        // 移送先の日報（同じ職長・新日付）を用意
        const target = await prisma.dailyReport.upsert({
            where: { foremanId_date: { foremanId: wi.dailyReport.foremanId, date: newJst } },
            create: { foremanId: wi.dailyReport.foremanId, date: newJst, updatedBy: actorUserId },
            update: {},
        });

        // 移送先に既に同じ配置の明細があれば重複→旧明細を削除、なければ付け替え
        const dup = await prisma.dailyReportWorkItem.findFirst({
            where: { dailyReportId: target.id, assignmentId, id: { not: wi.id } },
            select: { id: true },
        });
        if (dup) {
            await prisma.dailyReportWorkItem.delete({ where: { id: wi.id } });
        } else {
            await prisma.dailyReportWorkItem.update({ where: { id: wi.id }, data: { dailyReportId: target.id } });
        }
    }
}
