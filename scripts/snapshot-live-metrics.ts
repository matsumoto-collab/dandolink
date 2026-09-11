/**
 * 進行中の数字（DandoLink のデータ・2026-05 以降）の控えを取り、取り込みの前後で 1 円も変わっていないかを比べる。
 * 過去データ取込 仕様 4-3「進行中案件（2026年5月以降）の数字が取り込み前後で1円も変わらないこと」の確認用。読み取りのみ。
 *
 *   取り込む前: npx tsx scripts/snapshot-live-metrics.ts --out=before.json
 *   取り込んだ後: npx tsx scripts/snapshot-live-metrics.ts --out=after.json --compare=before.json
 *
 * 控える数字:
 *   ・月次売上（利益ダッシュボードの KPI・グラフ）の 2026-05 以降の各月
 *   ・担当者別の期間内訳（売上・原価・粗利）の 2026-05 以降の各月
 *   ・進行中の案件ごとの 請求額（税抜）・原価の内訳・延べ人工
 */
export {};
import fs from 'fs';

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const compareArg = process.argv.find((a) => a.startsWith('--compare='));
const OUT = outArg ? outArg.split('=')[1] : null;
const COMPARE = compareArg ? compareArg.split('=')[1] : null;

type Snapshot = Record<string, number>;

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { fetchMonthlySales, fetchMonthlyAssigneeBreakdown, SALES_INVOICE_STATUSES, invoiceProjectShares } = await import('../lib/profitDashboard');
    const { computeProjectCosts } = await import('../lib/projectCost');
    const { LIVE_DATA_START_MONTH, jstYearMonthOf } = await import('../lib/backfill/constants');
    const { monthsBetween } = await import('../lib/salesPerManDay');

    const snap: Snapshot = {};
    try {
        const nowYm = jstYearMonthOf(new Date());
        const liveMonths = monthsBetween(LIVE_DATA_START_MONTH, nowYm);

        // 1) 月次売上（税込）。表示は直近 24 か月までなので、その範囲で 2026-05 以降を控える
        const monthly = await fetchMonthlySales(24);
        for (const p of monthly.trend) {
            const ym = `${p.year}-${String(p.month).padStart(2, '0')}`;
            if (ym < LIVE_DATA_START_MONTH) continue;
            snap[`月次売上:${ym}:税込`] = p.sales;
            snap[`月次売上:${ym}:件数`] = p.invoiceCount;
        }

        // 2) 担当者別の期間内訳（税抜）
        for (const ym of liveMonths) {
            const [y, m] = ym.split('-').map(Number);
            const b = await fetchMonthlyAssigneeBreakdown({ year: y, month: m, axis: 'assignee' });
            snap[`内訳:${ym}:売上`] = b.totals.sales;
            snap[`内訳:${ym}:原価`] = b.totals.cost;
            snap[`内訳:${ym}:粗利`] = b.totals.grossProfit;
            snap[`内訳:${ym}:税込`] = b.totals.salesTaxIncluded;
            for (const r of b.rows) snap[`内訳:${ym}:担当:${r.name}:売上`] = r.sales;
        }

        // 3) 進行中の案件ごと（請求額・原価の内訳・延べ人工）
        const live = await prisma.projectMaster.findMany({ where: { isBackfilled: false }, select: { id: true } });
        const ids = live.map((p) => p.id);
        const invoices = await prisma.invoice.findMany({
            where: { isBackfilled: false, status: { in: [...SALES_INVOICE_STATUSES] } },
            select: { subtotal: true, items: true, projectMasterId: true },
        });
        const sales = new Map<string, number>();
        for (const inv of invoices) {
            for (const [pid, share] of invoiceProjectShares(inv)) sales.set(pid, (sales.get(pid) ?? 0) + Number(inv.subtotal) * share);
        }
        for (let i = 0; i < ids.length; i += 100) {
            const part = ids.slice(i, i + 100);
            const costs = await computeProjectCosts(part, { withDetail: true });
            for (const id of part) {
                const c = costs.get(id);
                const b = c?.breakdown;
                snap[`案件:${id}:請求額`] = Math.round(sales.get(id) ?? 0);
                snap[`案件:${id}:原価`] = b?.totalCost ?? 0;
                snap[`案件:${id}:人件費`] = b?.laborCost ?? 0;
                snap[`案件:${id}:外注費`] = b?.subcontractorCost ?? 0;
                snap[`案件:${id}:延べ人工`] = (c?.detail?.labor ?? []).reduce((s, r) => s + (r.workerCount || 0), 0);
            }
        }

        console.log(`控えた数字: ${Object.keys(snap).length}件（進行中の案件 ${ids.length}件・月 ${liveMonths.length}か月）`);
        if (OUT) {
            fs.writeFileSync(OUT, JSON.stringify(snap, null, 1));
            console.log(`保存: ${OUT}`);
        }

        if (COMPARE) {
            const before: Snapshot = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
            const keys = new Set([...Object.keys(before), ...Object.keys(snap)]);
            const diffs: string[] = [];
            for (const k of keys) {
                // 取り込み後に増えた「今月」の新しい請求などで差が出ないよう、比べるのは両方にある項目だけ
                if (!(k in before) || !(k in snap)) continue;
                if (before[k] !== snap[k]) diffs.push(`  ${k}: ${before[k]} → ${snap[k]}`);
            }
            const onlyBefore = [...keys].filter((k) => k in before && !(k in snap));
            console.log(`\n比べた項目 ${[...keys].filter((k) => k in before && k in snap).length}件 / 違い ${diffs.length}件 / 前にだけあった項目 ${onlyBefore.length}件`);
            for (const d of diffs.slice(0, 50)) console.log(d);
            if (onlyBefore.length) console.log('  前にだけあった項目（例）:', onlyBefore.slice(0, 10).join(', '));
            if (diffs.length === 0 && onlyBefore.length === 0) console.log('\n✓ 進行中の数字は 1 円も変わっていません');
            else process.exitCode = 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
