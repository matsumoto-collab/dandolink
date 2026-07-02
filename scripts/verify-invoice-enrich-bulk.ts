/**
 * 読み取り専用の検証: /api/invoices の N+1 解消（一括取得化）の前後で
 * 各請求書の projectMasters（内容・順序）が完全一致することを本番データで確認する。
 * 実行: npx tsx scripts/verify-invoice-enrich-bulk.ts
 */
import { PrismaClient } from '@prisma/client';

const baseUrl = process.env.DATABASE_URL ?? '';
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'connection_limit=1';
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function oldEnrich(invoiceId: string) {
    const links = await prisma.invoiceProjectMaster.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
        select: { projectMasterId: true },
    });
    if (links.length === 0) return [] as Array<{ id: string; title: string }>;
    const pmIds = links.map((l) => l.projectMasterId);
    const pms = await prisma.projectMaster.findMany({
        where: { id: { in: pmIds } },
        select: { id: true, title: true },
    });
    return pmIds.map((id) => pms.find((p) => p.id === id)).filter(Boolean) as Array<{ id: string; title: string }>;
}

async function newBulk(invoiceIds: string[]) {
    const map = new Map<string, Array<{ id: string; title: string }>>();
    if (invoiceIds.length === 0) return map;
    const links = await prisma.invoiceProjectMaster.findMany({
        where: { invoiceId: { in: invoiceIds } },
        orderBy: { sortOrder: 'asc' },
        select: { invoiceId: true, projectMasterId: true },
    });
    const pmIds = Array.from(new Set(links.map((l) => l.projectMasterId)));
    if (pmIds.length === 0) return map;
    const pms = await prisma.projectMaster.findMany({
        where: { id: { in: pmIds } },
        select: { id: true, title: true },
    });
    const pmById = new Map(pms.map((p) => [p.id, p] as const));
    for (const l of links) {
        const pm = pmById.get(l.projectMasterId);
        if (!pm) continue;
        const arr = map.get(l.invoiceId) ?? [];
        arr.push(pm);
        map.set(l.invoiceId, arr);
    }
    return map;
}

async function main() {
    const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true } });
    console.log(`invoices: ${invoices.length}`);

    let a = performance.now();
    const bulk = await newBulk(invoices.map((i) => i.id));
    console.log(`new bulk (2 queries): ${Math.round(performance.now() - a)}ms`);

    a = performance.now();
    let mismatch = 0;
    let withPm = 0;
    for (const inv of invoices) {
        const oldPms = await oldEnrich(inv.id);
        const newPms = bulk.get(inv.id) ?? [];
        if (oldPms.length > 0) withPm++;
        if (JSON.stringify(oldPms) !== JSON.stringify(newPms)) {
            mismatch++;
            console.log(`MISMATCH invoice=${inv.id}`);
            console.log('  old:', JSON.stringify(oldPms));
            console.log('  new:', JSON.stringify(newPms));
        }
    }
    console.log(`old serial N+1: ${Math.round(performance.now() - a)}ms`);
    console.log(`invoices with projectMasters: ${withPm}/${invoices.length}`);
    console.log(mismatch === 0 ? '✅ 全請求書で新旧一致（内容・順序とも）' : `❌ 不一致 ${mismatch} 件`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
