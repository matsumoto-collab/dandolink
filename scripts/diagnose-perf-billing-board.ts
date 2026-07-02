/**
 * 読み取り専用の性能診断。請求待ちボード /api/billing-board と /api/invoices が
 * 実際に発行しているクエリを再現して件数・所要時間を測る。書き込みは一切しない。
 * 実行: npx tsx scripts/diagnose-perf-billing-board.ts
 */
import { PrismaClient } from '@prisma/client';

// 本番プール（セッションモード上限15）を圧迫しないよう、この診断は接続1本に固定する
const baseUrl = process.env.DATABASE_URL ?? '';
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'connection_limit=1';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const t = () => performance.now();
const ms = (a: number) => `${Math.round(performance.now() - a)}ms`;

async function main() {
    // ── 件数 ─────────────────────────────
    const [invoiceCount, ipmCount, payCount, estimateCount, pmCount, asgCount, customerCount] = await Promise.all([
        prisma.invoice.count(),
        prisma.invoiceProjectMaster.count(),
        prisma.invoicePayment.count(),
        prisma.estimate.count(),
        prisma.projectMaster.count(),
        prisma.projectAssignment.count(),
        prisma.customer.count(),
    ]);
    console.log('--- row counts ---');
    console.log({ invoiceCount, ipmCount, payCount, estimateCount, pmCount, asgCount, customerCount });

    // ── /api/invoices 相当（全請求書 findMany）───────
    let a = t();
    const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
    console.log('--- /api/invoices ---');
    console.log(`invoice.findMany(all): ${ms(a)} (${invoices.length} rows)`);
    const payloadBytes = JSON.stringify(invoices).length;
    console.log(`raw payload approx: ${(payloadBytes / 1024).toFixed(0)} KB`);

    // enrichInvoice の N+1 を先頭20件だけ直列で実測して外挿（本番負荷を抑える）
    a = t();
    const sample = invoices.slice(0, 20);
    for (const inv of sample) {
        const links = await prisma.invoiceProjectMaster.findMany({
            where: { invoiceId: inv.id },
            orderBy: { sortOrder: 'asc' },
            select: { projectMasterId: true },
        });
        if (links.length > 0) {
            await prisma.projectMaster.findMany({
                where: { id: { in: links.map((l) => l.projectMasterId) } },
                select: { id: true, title: true },
            });
        }
    }
    const per20 = performance.now() - a;
    console.log(
        `enrich N+1 sample(20 invoices, serial over 1 conn): ${Math.round(per20)}ms → est. all ${invoices.length}: ~${Math.round((per20 / 20) * invoices.length)}ms (~${invoices.length * 2} queries per GET)`,
    );

    // ── /api/billing-board 相当 ───────
    console.log('--- /api/billing-board (closing mode, this month) ---');
    const jst = new Date(Date.now() + 9 * 3600_000);
    const y = jst.getUTCFullYear();
    const m0 = jst.getUTCMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const prev = new Date(Date.UTC(y, m0 - 1, 1));
    const lastOfRef = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    const start = new Date(`${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-01T00:00:00+09:00`);
    const end = new Date(`${y}-${pad(m0 + 1)}-${pad(lastOfRef)}T23:59:59.999+09:00`);

    a = t();
    const projects = await prisma.projectMaster.findMany({
        where: { status: { not: 'cancelled' }, assignments: { some: { date: { gte: start, lte: end } } } },
        select: { id: true },
    });
    console.log(`projects in superset window: ${ms(a)} (${projects.length} rows)`);
    const projectIds = projects.map((p) => p.id);

    a = t();
    const inv2 = await prisma.invoice.findMany({
        select: { status: true, subtotal: true, items: true, projectMasterId: true, createdAt: true },
    });
    const asg2 = await prisma.projectAssignment.findMany({
        where: { projectMasterId: { in: projectIds }, date: { gte: start, lte: end } },
        select: { projectMasterId: true, date: true, constructionType: true, assignedEmployeeId: true, memberCount: true },
        orderBy: { date: 'asc' },
    });
    const est2 = await prisma.estimate.findMany({
        where: { projectMasterId: { in: projectIds } },
        select: { projectMasterId: true, status: true, subtotal: true },
    });
    console.log(`board parallel fetch: ${ms(a)} (invoices=${inv2.length}, assignments=${asg2.length}, estimates=${est2.length})`);
    const itemsBytes = inv2.reduce(
        (s, i) => s + (typeof i.items === 'string' ? (i.items as string).length : JSON.stringify(i.items ?? '').length),
        0,
    );
    console.log(`invoice.items total JSON size: ${(itemsBytes / 1024).toFixed(0)} KB`);

    // ── financeストアが読む全件系 ───────
    a = t();
    const ests = await prisma.estimate.findMany({ orderBy: { createdAt: 'desc' } });
    console.log('--- full-table fetches used by stores ---');
    console.log(`estimate.findMany(all): ${ms(a)} (${ests.length} rows, ~${(JSON.stringify(ests).length / 1024).toFixed(0)} KB)`);

    a = t();
    const pms = await prisma.projectMaster.findMany();
    console.log(`projectMaster.findMany(all): ${ms(a)} (${pms.length} rows, ~${(JSON.stringify(pms).length / 1024).toFixed(0)} KB)`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
