/**
 * 人件費の二重計上になりうる配置を全社スキャン（読み取り専用）
 * 検出パターン:
 *   A) 1配置に複数日付の作業明細がぶら下がる（=別日の作業が混入。今回のトヨタ型）
 *   B) 1配置に明細が2件以上あり、うち1件以上が「作業者0名」（=空明細が満額自動計上で水増し）
 *   C) 1配置に作業者0名の明細のみ（フォールバックで人数×満額。正当な場合もあるが要確認）
 *
 *   npx tsx scripts/scan-dup-workitems.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
function jstKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function calcTimeDiffMinutes(s: string, e: string): number {
    if (!s || !e) return 0;
    const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number);
    if ([sh, sm, eh, em].some(v => Number.isNaN(v))) return 0;
    let d = (eh * 60 + em) - (sh * 60 + sm); if (d < 0) d += 1440; return d;
}

async function main() {
    const assignments = await prisma.projectAssignment.findMany({
        where: { dailyReportWorkItems: { some: {} } },
        select: {
            id: true, date: true, assignedEmployeeId: true, memberCount: true, workers: true,
            projectMaster: { select: { name: true, title: true } },
            dailyReportWorkItems: {
                select: { id: true, workerIds: true, startTime: true, endTime: true, breakMinutes: true, createdAt: true, dailyReport: { select: { date: true } } },
            },
        },
    });

    // partner職長は労務に計上されないので、影響度の注記に使う
    const fids = [...new Set(assignments.map(a => a.assignedEmployeeId).filter(Boolean))] as string[];
    const fmap = new Map((await prisma.user.findMany({ where: { id: { in: fids } }, select: { id: true, displayName: true, role: true } })).map(u => [u.id, u]));

    type Row = { a: typeof assignments[number]; dates: string[]; emptyItems: number; nItems: number; hours: number; pj: string; foreman: string; isPartner: boolean };
    const A: Row[] = []; const B: Row[] = []; const C: Row[] = [];

    for (const a of assignments) {
        const dateSet = new Set<string>();
        let emptyItems = 0; let mins = 0;
        const aWorkers = (() => { try { return JSON.parse(a.workers ?? '[]'); } catch { return []; } })();
        for (const wi of a.dailyReportWorkItems) {
            if (wi.dailyReport) dateSet.add(jstKey(wi.dailyReport.date));
            const empty = wi.workerIds.length === 0 && aWorkers.length === 0;
            if (empty) emptyItems++;
            mins += Math.max(0, calcTimeDiffMinutes(wi.startTime ?? '', wi.endTime ?? '') - (wi.breakMinutes || 0));
        }
        const f = a.assignedEmployeeId ? fmap.get(a.assignedEmployeeId) : undefined;
        const row: Row = {
            a, dates: [...dateSet].sort(), emptyItems, nItems: a.dailyReportWorkItems.length,
            hours: Math.round(mins / 6) / 10, pj: a.projectMaster?.name || a.projectMaster?.title || '?',
            foreman: f?.displayName ?? '—', isPartner: f?.role === 'partner',
        };
        if (row.dates.length >= 2) A.push(row);
        else if (row.nItems >= 2 && row.emptyItems >= 1) B.push(row);
        else if (row.nItems >= 1 && row.emptyItems === row.nItems) C.push(row);
    }

    const fmt = (r: Row) => `  [${r.isPartner ? '協力(労務対象外)' : '自社'}] ${r.pj} / 配置${jstKey(r.a.date)}(${r.a.id.slice(0, 8)}) ${r.foreman}班 人数${r.a.memberCount} 明細${r.nItems}件 空${r.emptyItems} 計${r.hours}h 日付[${r.dates.join(', ')}]`;
    const sortKey = (r: Row) => r.a.date.getTime();

    console.log(`\n##### A) 複数日付の明細が1配置に混入（最重要・今回のトヨタ型）: ${A.length}件 #####`);
    for (const r of A.sort((x, y) => sortKey(x) - sortKey(y))) {
        console.log(fmt(r));
        for (const wi of r.a.dailyReportWorkItems.slice().sort((x, y) => (x.dailyReport?.date.getTime() ?? 0) - (y.dailyReport?.date.getTime() ?? 0))) {
            const m = Math.max(0, calcTimeDiffMinutes(wi.startTime ?? '', wi.endTime ?? '') - (wi.breakMinutes || 0));
            console.log(`        ・日報${wi.dailyReport ? jstKey(wi.dailyReport.date) : '?'} ${wi.startTime}-${wi.endTime}(${(m / 60).toFixed(1)}h) 作業者${wi.workerIds.length}名 作成=${jstKey(wi.createdAt)} item=${wi.id.slice(0, 8)}`);
        }
    }

    console.log(`\n##### B) 空明細が他明細と共存（満額×人数で水増し）: ${B.length}件 #####`);
    for (const r of B.sort((x, y) => sortKey(x) - sortKey(y))) console.log(fmt(r));

    console.log(`\n##### C) 空作業者の明細のみ（人数×満額の自動補完・要確認、正当な場合あり）: ${C.length}件 #####`);
    console.log(`  （件数のみ。自社${C.filter(r => !r.isPartner).length} / 協力${C.filter(r => r.isPartner).length}）`);

    console.log(`\n=== サマリ ===  A=${A.length}  B=${B.length}  C=${C.length}  /  対象配置(明細あり)=${assignments.length}`);
    console.log(`A+B のうち 自社(労務計上される)= ${[...A, ...B].filter(r => !r.isPartner).length}件 が金額に影響`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
