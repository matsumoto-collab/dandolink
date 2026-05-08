/**
 * 協力会社メンバー機能 (feature/partner-members) の調査・検証用スクリプト。
 * 読み取り専用。Step 1 のスキーマ変更後・マイグレーション適用後の確認にも再利用する想定。
 *
 * 用途:
 *   - PARTNER ロールユーザーの一覧
 *   - AssignmentWorker.workerId の埋まり具合確認（NULL/NOT NULL 比率）
 *   - User の role 別件数集計
 *
 * 実行: node scripts/investigate-partner.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    const partners = await p.user.findMany({
      where: { role: { in: ['partner', 'PARTNER'] } },
      select: { id: true, username: true, displayName: true, role: true, teamId: true, isActive: true },
    });
    console.log('=== partner role users ===');
    console.log('count:', partners.length);
    console.log(JSON.stringify(partners, null, 2));

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentAssignments = await p.projectAssignment.findMany({
      where: { date: { gte: since } },
      select: { id: true },
    });
    const aIds = recentAssignments.map(a => a.id);
    const total = await p.assignmentWorker.count({ where: { assignmentId: { in: aIds } } });
    const withId = await p.assignmentWorker.count({ where: { assignmentId: { in: aIds }, workerId: { not: null } } });
    const nullId = total - withId;
    console.log('\n=== AssignmentWorker (last 30 days) ===');
    console.log('total:', total, ' workerId NOT NULL:', withId, ' workerId NULL:', nullId);

    const samples = await p.assignmentWorker.findMany({
      where: { assignmentId: { in: aIds }, workerId: { not: null } },
      take: 3,
      select: { id: true, workerId: true, workerName: true },
    });
    console.log('\nsamples (workerId NOT NULL):');
    for (const s of samples) {
      const u = await p.user.findUnique({ where: { id: s.workerId }, select: { id: true, displayName: true, role: true } });
      console.log({ aw: s, matchedUser: u });
    }

    const allUsersCount = await p.user.count();
    const byRole = await p.user.groupBy({ by: ['role'], _count: { _all: true } });
    console.log('\n=== User counts by role ===');
    console.log('total:', allUsersCount);
    console.log(byRole);
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
