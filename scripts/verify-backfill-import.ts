/**
 * 過去データ取込の完了条件（仕様書 v1.0 の 4 章）を、取り込んだ後の DB で検算する。読み取りのみ。
 *
 *   npx tsx scripts/verify-backfill-import.ts
 *
 * 期待値は仕様書の数字。ただし CSV 自体が仕様書の数字と違う箇所は、CSV の値も並べて出す
 * （第12期の人工は CSV だと 6,089・仕様書は 6,094。出典=請求書 の案件にも自社人工のある行が 203 件ある）。
 */
export {};

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const yen = (n: number) => n.toLocaleString('ja-JP');

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { fiscalTermRange, jstYearMonthOf } = await import('../lib/backfill/constants');
    let failed = 0;
    const check = (label: string, actual: number, expected: number, note = '') => {
        const ok = actual === expected;
        if (!ok) failed++;
        console.log(`${ok ? '✓' : '✗'} ${label}: ${yen(actual)}${ok ? '' : `（期待 ${yen(expected)}）`}${note ? `  ${note}` : ''}`);
    };

    try {
        // ---- 4-1 合計 ----
        const [projects, invoiceSum, adjustmentSum, manDays] = await Promise.all([
            prisma.projectMaster.count({ where: { isBackfilled: true } }),
            prisma.invoice.aggregate({ where: { isBackfilled: true }, _sum: { subtotal: true } }),
            prisma.revenueAdjustment.aggregate({ _sum: { amountExclTax: true } }),
            prisma.projectAssignment.aggregate({ where: { isBackfilled: true }, _sum: { memberCount: true } }),
        ]);
        const sales = Number(invoiceSum._sum.subtotal ?? 0);
        const adjustments = adjustmentSum._sum.amountExclTax ?? 0;
        console.log('=== 4-1 合計 ===');
        check('過去案件の件数', projects, 3681);
        check('現場別売上の合計（税抜）', sales, 564467339);
        check('売上調整の合計（税抜）', adjustments, 61234635);
        check('売上の総合計（税抜）', sales + adjustments, 625701974);
        check('自社の延べ人工', manDays._sum.memberCount ?? 0, 12750);

        // ---- 4-2 期別 ----
        console.log('\n=== 4-2 期別 ===');
        const [bfInvoices, bfAssignments, adjs] = await Promise.all([
            prisma.invoice.findMany({ where: { isBackfilled: true }, select: { subtotal: true, createdAt: true } }),
            prisma.projectAssignment.findMany({ where: { isBackfilled: true, memberCount: { gt: 0 } }, select: { date: true, memberCount: true } }),
            prisma.revenueAdjustment.findMany({ select: { yearMonth: true, amountExclTax: true } }),
        ]);
        const termOf = (term: number) => {
            const { from, to } = fiscalTermRange(term);
            const inT = (ym: string) => ym >= from && ym <= to;
            const s = bfInvoices.filter((i) => inT(jstYearMonthOf(i.createdAt))).reduce((t, i) => t + Number(i.subtotal), 0)
                + adjs.filter((a) => inT(a.yearMonth)).reduce((t, a) => t + a.amountExclTax, 0);
            const m = bfAssignments.filter((a) => inT(jstYearMonthOf(a.date))).reduce((t, a) => t + a.memberCount, 0);
            return { s, m, r: m > 0 ? Math.round(s / m) : 0 };
        };
        const t11 = termOf(11);
        check('第11期 売上（税抜）', t11.s, 291713959);
        check('第11期 延べ人工', t11.m, 4901);
        check('第11期 売上 ÷ 人工', t11.r, 59521);
        const t11Incl = Math.round(t11.s * 1.1);
        const vsSettlement = ((t11Incl / 313249374 - 1) * 100).toFixed(1);
        console.log(`  第11期 税込 ${yen(t11Incl)} / 決算の完成工事高 313,249,374 との差 +${vsSettlement}%（仕様書は +2.4%）`);
        const t12 = termOf(12);
        check('第12期 売上（税抜）', t12.s, 252830993, '← CSV の値は 252,830,996（税抜換算の丸め）');
        check('第12期 延べ人工', t12.m, 6094, '← CSV の値は 6,089（2025-06 が −2・2025-11 が −3）');
        check('第12期 売上 ÷ 人工', t12.r, 41489);

        // ---- 4-3 個別 ----
        console.log('\n=== 4-3 個別 ===');
        const target = await prisma.projectMaster.findMany({
            where: { isBackfilled: true, title: { contains: '男女共同参画推進センター' } },
            select: { id: true, title: true, externalKey: true },
        });
        for (const t of target) {
            const range = await prisma.projectAssignment.aggregate({
                where: { projectMasterId: t.id, isBackfilled: true },
                _min: { date: true }, _max: { date: true }, _count: { _all: true },
            });
            console.log(`  ${t.externalKey} ${t.title}: 作業履歴 ${range._count._all}件 ${range._min.date ? jstYearMonthOf(range._min.date) : '—'}〜${range._max.date ? jstYearMonthOf(range._max.date) : '—'}`);
        }
        if (target.length === 0) { failed++; console.log('✗ 「男女共同参画推進センター」を含む過去案件が見つかりません'); }

        const invoiceOnly = await prisma.projectMaster.findMany({ where: { isBackfilled: true, dataSource: '請求書' }, select: { id: true } });
        const ownOnInvoiceOnly = await prisma.projectAssignment.aggregate({
            where: { isBackfilled: true, projectMasterId: { in: invoiceOnly.map((p) => p.id) }, memberCount: { gt: 0 } },
            _sum: { memberCount: true }, _count: { _all: true },
        });
        console.log(`  出典=請求書 の案件 ${invoiceOnly.length}件 の自社人工: ${yen(ownOnInvoiceOnly._sum.memberCount ?? 0)}（仕様書は 0。CSV の出典の付け方の問題で 1,685 になる）`);

        const liveTouched = await prisma.projectMaster.count({ where: { isBackfilled: false, importBatchId: { not: null } } });
        check('進行中の案件に取込の印が付いた件数', liveTouched, 0);
        console.log('\n  進行中の数字の前後比較は scripts/snapshot-live-metrics.ts で行ってください。');

        console.log(failed === 0 ? '\nすべて期待どおりです。' : `\n期待と違う項目: ${failed}件（CSV 自体が仕様書と違う項目を含む）`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
