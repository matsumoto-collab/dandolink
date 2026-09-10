/**
 * 「作業履歴の(N名)＝memberCount」と「利益サマリーの総人数＝原価計上した作業者数」の
 * ズレの原因を、実データで配置1件ずつ追跡する読み取り専用スクリプト。
 *
 * lib/projectCost.ts の労務費ロジックと同じ順序で「その日の作業者ID」を決め、
 * どの経路（日報の作業者／配置のworkers／手配確定＋職長／memberCount合成）で
 * 決まったかを配置ごとに出す。
 *
 * 実行: npx tsx -r dotenv/config scripts/diagnose-headcount-mismatch.ts [案件名の一部...]
 */
const base = process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;




const KEYWORDS = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['平松', '道前道後', 'ジブラルタ', '愛媛製紙', 'カネシロ', '山根'];

function parseJson<T>(value: unknown, fallback: T): T {
    if (value == null) return fallback;
    if (Array.isArray(value)) return value as unknown as T;
    if (typeof value === 'string') {
        try { return JSON.parse(value) as T; } catch { return fallback; }
    }
    return fallback;
}

function minutesOf(start: string | null, end: string | null, brk: number): number {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return 0;
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - (brk || 0));
}

const jst = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function main() {
    const { prisma } = await import("../lib/prisma");
    const { computeProjectCosts } = await import("../lib/projectCost");
    const projects = await prisma.projectMaster.findMany({
        where: { OR: KEYWORDS.map(k => ({ title: { contains: k } })) },
        select: { id: true, title: true, status: true },
        orderBy: { title: 'asc' },
    });
    console.log(`対象案件: ${projects.length}件\n`);

    const costs = await computeProjectCosts(projects.map(p => p.id), { withDetail: true });

    for (const pm of projects) {
        const assignments = await prisma.projectAssignment.findMany({
            where: { projectMasterId: pm.id },
            select: {
                id: true, date: true, assignedEmployeeId: true, memberCount: true,
                workers: true, confirmedWorkerIds: true, laborCostOverride: true,
                dailyReportWorkItems: {
                    select: {
                        id: true, startTime: true, endTime: true, breakMinutes: true, workerIds: true,
                        dailyReport: { select: { date: true } },
                    },
                },
            },
            orderBy: { date: 'asc' },
        });

        const cost = costs.get(pm.id);
        const laborRows = cost?.detail?.labor ?? [];
        const rowByAssignment = new Map(laborRows.map(r => [r.assignmentId, r]));

        let memberSum = 0;
        let workerSum = 0;
        const reasons = new Map<string, number>();

        console.log('='.repeat(100));
        console.log(`${pm.title}  [${pm.status}]`);
        console.log('  日付        member  総人数  経路                    時間  人件費');

        for (const a of assignments) {
            const aWorkers = parseJson<string[]>(a.workers, []);
            const confirmed = parseJson<string[]>(a.confirmedWorkerIds, []);
            const row = rowByAssignment.get(a.id);
            const counted = row?.workerCount ?? 0;
            memberSum += a.memberCount || 0;
            workerSum += counted;

            // どの経路で作業者IDが決まるか（最初の有効な作業項目で判定）
            const items = a.dailyReportWorkItems.filter(wi => wi.dailyReport);
            const valid = items.filter(wi => minutesOf(wi.startTime, wi.endTime, wi.breakMinutes || 0) > 0);
            let route: string;
            if (!row) route = '原価計上なし(協力業者職長など)';
            else if (items.length === 0) route = '日報なし';
            else if (valid.length === 0) route = '日報あり・作業時間0';
            else if (valid.some(wi => wi.workerIds.length > 0)) route = '日報の作業者';
            else if (aWorkers.length > 0) route = '配置のworkers';
            else if (confirmed.length > 0) route = '手配確定＋職長';
            else route = 'memberCount合成';

            reasons.set(route, (reasons.get(route) ?? 0) + 1);

            const diff = counted - (a.memberCount || 0);
            const mark = diff === 0 ? ' ' : diff > 0 ? '+' : '-';
            console.log(
                `  ${jst(a.date)}  ${String(a.memberCount ?? 0).padStart(5)}  ${String(counted).padStart(5)}${mark}  ${route.padEnd(22)}  ${String(row?.hours ?? 0).padStart(5)}  ${String(row?.effectiveCost ?? 0).padStart(8)}`,
            );
        }

        console.log(`  ── 合計: memberCount ${memberSum}人 / 総人数 ${workerSum}人 （差 ${workerSum - memberSum}）`);
        console.log(`     経路の内訳: ${[...reasons.entries()].map(([k, v]) => `${k}=${v}`).join(' / ')}`);
        const b = cost?.breakdown;
        if (b) {
            console.log(`     原価: 人件費 ${b.laborCost} / 車両 ${b.vehicleCost} / 材料 ${b.materialCost} / 外注 ${b.subcontractorCost} / 積込 ${b.loadingCost} / その他 ${b.otherExpenses} / 合計 ${b.totalCost}`);
            if (workerSum > 0) console.log(`     1人工あたり人件費: ${Math.round(b.laborCost / workerSum)}円`);
        }
        console.log();
    }
}

async function run() {
    try { await main(); } catch (e) { console.error(e); process.exitCode = 1; }
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
}
run();
/*
    .catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
*/

export {};
