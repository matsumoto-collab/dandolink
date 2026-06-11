/**
 * 作業履歴で職長が「不明」と表示される配置の全社スキャン（読み取り専用）。
 *
 * 「不明」の条件: ProjectAssignment.assignedEmployeeId が User テーブルに存在しない。
 * （退職などの論理削除 isActive=false は User 行が残るため「不明」にならない。
 *   物理削除されたユーザー・旧モックID等の孤児IDだけが該当する）
 *
 * カレンダーは職長行ベースの描画のため、職長一覧に居ないIDの配置はどの行にも
 * 表示されず「カレンダーに見えないのに履歴には出る・消せない」状態になる。
 *
 *   npx tsx scripts/scan-unknown-foreman-assignments.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function jstKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function main() {
    const assignments = await prisma.projectAssignment.findMany({
        select: {
            id: true,
            assignedEmployeeId: true,
            date: true,
            memberCount: true,
            isDispatchConfirmed: true,
            createdAt: true,
            projectMaster: { select: { id: true, title: true } },
            dailyReportWorkItems: { select: { id: true } },
        },
        orderBy: { date: 'asc' },
    });

    const employeeIds = Array.from(new Set(assignments.map((a) => a.assignedEmployeeId).filter(Boolean)));
    const users = await prisma.user.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, displayName: true, isActive: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const orphans = assignments.filter((a) => a.assignedEmployeeId && !userMap.has(a.assignedEmployeeId));

    console.log(`配置総数: ${assignments.length}`);
    console.log(`「不明」になる配置（assignedEmployeeId が User に不在）: ${orphans.length}件\n`);

    if (orphans.length === 0) {
        console.log('該当なし');
        return;
    }

    // 孤児ID別に集計
    const byId = new Map<string, typeof orphans>();
    for (const o of orphans) {
        const list = byId.get(o.assignedEmployeeId) ?? [];
        list.push(o);
        byId.set(o.assignedEmployeeId, list);
    }

    console.log('── 孤児ID別の件数 ──');
    for (const [id, list] of byId) {
        const looksLikeMockId = /^\d+$/.test(id);
        console.log(`  assignedEmployeeId=${id} ${looksLikeMockId ? '（旧モックID形式）' : ''}: ${list.length}件`);
    }

    console.log('\n── 明細 ──');
    for (const o of orphans) {
        console.log(
            [
                `配置ID=${o.id}`,
                `日付(JST)=${jstKey(o.date)}`,
                `案件=${o.projectMaster?.title ?? '(案件なし)'}`,
                `職長ID=${o.assignedEmployeeId}`,
                `人数=${o.memberCount}`,
                `確定=${o.isDispatchConfirmed ? 'はい' : 'いいえ'}`,
                `日報明細=${o.dailyReportWorkItems.length}件`,
                `作成=${jstKey(o.createdAt)}`,
            ].join(' / ')
        );
    }

    // 作成経路の手がかり: フル詳細 + 操作履歴
    const orphanIds = orphans.map((o) => o.id);
    const [details, histories] = await Promise.all([
        prisma.projectAssignment.findMany({
            where: { id: { in: orphanIds } },
            select: {
                id: true,
                workers: true,
                vehicles: true,
                remarks: true,
                estimatedHours: true,
                constructionType: true,
                sortOrder: true,
                meetingTime: true,
                createdAt: true,
            },
        }),
        prisma.scheduleChangeHistory.findMany({
            where: { assignmentId: { in: orphanIds } },
            orderBy: { changedAt: 'asc' },
        }),
    ]);

    console.log('\n── フル詳細（作成経路の手がかり） ──');
    for (const d of details) {
        console.log(JSON.stringify(d, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    }

    console.log(`\n── 操作履歴（ScheduleChangeHistory）: ${histories.length}件 ──`);
    const changedByIds = Array.from(new Set(histories.map((h) => h.changedById)));
    const changedByUsers = changedByIds.length
        ? await prisma.user.findMany({ where: { id: { in: changedByIds } }, select: { id: true, displayName: true } })
        : [];
    const changedByMap = new Map(changedByUsers.map((u) => [u.id, u.displayName]));
    for (const h of histories) {
        console.log(
            `  ${h.changedAt.toISOString()} / assignment=${h.assignmentId} / type=${h.changeType} / by=${changedByMap.get(h.changedById) ?? h.changedById} / prev=${h.previousValue} / new=${h.newValue}`
        );
    }

    // 参考: 非アクティブ（退職等）ユーザーが職長の配置 — こちらは「不明」にはならない
    const inactiveForemanCount = assignments.filter((a) => {
        const u = userMap.get(a.assignedEmployeeId);
        return u && !u.isActive;
    }).length;
    console.log(`\n（参考）退職等 isActive=false のユーザーが職長の配置: ${inactiveForemanCount}件 — これらは名前表示され「不明」にはならない`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
