/**
 * 「人工あたり加工高」の検証スクリプト（読み取り専用）。
 *
 * 仕様書 6-3 の総人数ベース検証表と実データを突合する。
 * 計算は既存の利益タブと同じ材料だけを使う:
 *   売上   = 請求(税抜・まとめ請求は按分) … app/api/project-masters/[id]/profit と同じ
 *   原価   = computeProjectCosts（利益ダッシュボードと共通エンジン）
 *   総人数 = 労務費明細の workerCount 合計（利益サマリーの「総人数」と同じ）
 *
 * 実行: npx tsx -r dotenv/config scripts/verify-value-added-per-manday.ts
 */
const base = process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;

/** 仕様書 6-3 の期待値（総人数ベース） */
const EXPECTED: { key: string; label: string; valueAdded: number; headcount: number; perManday: number }[] = [
    { key: 'ジブラルタ生命様 大規模修繕', label: 'ジブラルタ生命様 大規模修繕', valueAdded: 10014803, headcount: 161, perManday: 62204 },
    { key: '男女共同参画', label: '松山市男女共同参画推進センター様', valueAdded: 3115881, headcount: 185, perManday: 16843 },
    { key: '道前道後', label: '道前道後第三発電所', valueAdded: 580000, headcount: 24, perManday: 24167 },
    { key: '愛媛製紙1原パルパ室', label: '愛媛製紙1原パルパ室', valueAdded: 406100, headcount: 8, perManday: 50762 },
    { key: 'カネシロ', label: 'カネシロ様 伊予松前リサイクルセンター', valueAdded: 67000, headcount: 4, perManday: 16750 },
    { key: '清水', label: '清水様邸 新築', valueAdded: 743300, headcount: 14, perManday: 53093 },
    { key: '平松　有信', label: '平松 有信様邸', valueAdded: 354000, headcount: 9, perManday: 39333 },
    { key: '山根', label: '山根 大介様邸', valueAdded: 60000, headcount: 1, perManday: 60000 },
    { key: '濱田', label: '濱田 裕之様邸', valueAdded: 248500, headcount: 7, perManday: 35500 },
    { key: '一色', label: '一色様邸 南斎院', valueAdded: 172000, headcount: 5, perManday: 34400 },
];

function yen(n: number): string {
    return n.toLocaleString('ja-JP');
}

function diffMark(actual: number, expected: number): string {
    if (actual === expected) return '一致';
    const d = actual - expected;
    return `差 ${d > 0 ? '+' : ''}${yen(d)}`;
}

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { computeProjectCosts } = await import('../lib/projectCost');
    const { SALES_INVOICE_STATUSES, invoiceProjectShares } = await import('../lib/profitDashboard');

    for (const exp of EXPECTED) {
        const candidates = await prisma.projectMaster.findMany({
            where: { title: { contains: exp.key } },
            select: { id: true, title: true, status: true, revenueOverride: true, contractAmount: true },
        });
        // 完了案件を優先（同名の進行中案件があるため）
        const pm = candidates.find(c => c.status === 'completed') ?? candidates[0];
        if (!pm) {
            console.log(`【${exp.label}】案件が見つかりません（キー: ${exp.key}）\n`);
            continue;
        }

        const [invoices, costMap] = await Promise.all([
            prisma.invoice.findMany({
                where: {
                    status: { in: [...SALES_INVOICE_STATUSES] },
                    OR: [{ projectMasterId: pm.id }, { items: { contains: pm.id } }],
                },
                select: { subtotal: true, total: true, items: true, projectMasterId: true },
            }),
            computeProjectCosts([pm.id], { withDetail: true }),
        ]);

        let invoiceSubtotal = 0;
        for (const inv of invoices) {
            const share = invoiceProjectShares(inv).get(pm.id) ?? 0;
            if (share > 0) invoiceSubtotal += Number(inv.subtotal) * share;
        }
        invoiceSubtotal = Math.round(invoiceSubtotal);

        const cost = costMap.get(pm.id);
        const b = cost?.breakdown ?? {
            laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
        };
        const headcount = (cost?.detail?.labor ?? []).reduce((s, r) => s + (r.workerCount || 0), 0);

        const sales = invoiceSubtotal;
        const nonLabor = b.totalCost - b.laborCost;
        const valueAdded = sales - nonLabor;
        const perManday = headcount > 0 ? Math.floor(valueAdded / headcount) : null;
        const productivity = b.laborCost > 0 ? valueAdded / b.laborCost : null;
        const outsourcingRatio = sales > 0 ? b.subcontractorCost / sales : 0;

        console.log('='.repeat(96));
        console.log(`【${exp.label}】`);
        console.log(`  実データ: ${pm.title} [${pm.status}]`);
        console.log(`  売上(確定・税抜)   ${yen(sales).padStart(12)}`);
        console.log(`  原価合計           ${yen(b.totalCost).padStart(12)}  = 人件費 ${yen(b.laborCost)} + 人件費以外 ${yen(nonLabor)}`);
        console.log(`    内訳: 車両 ${yen(b.vehicleCost)} / 材料 ${yen(b.materialCost)} / 外注 ${yen(b.subcontractorCost)} / 積込 ${yen(b.loadingCost)} / その他 ${yen(b.otherExpenses)}`);
        console.log(`  加工高             ${yen(valueAdded).padStart(12)}  期待 ${yen(exp.valueAdded).padStart(12)}  ${diffMark(valueAdded, exp.valueAdded)}`);
        console.log(`  総人数             ${String(headcount).padStart(12)}  期待 ${String(exp.headcount).padStart(12)}  ${headcount === exp.headcount ? '一致' : `差 ${headcount - exp.headcount}`}`);
        console.log(`  人工あたり加工高   ${(perManday === null ? '—' : yen(perManday)).padStart(12)}  期待 ${yen(exp.perManday).padStart(12)}  ${perManday === null ? '' : diffMark(perManday, exp.perManday)}`);
        console.log(`  労働生産性倍率     ${(productivity === null ? '—' : productivity.toFixed(2) + '倍').padStart(12)}`);
        console.log(`  外注比率(外注÷売上) ${(sales > 0 ? (outsourcingRatio * 100).toFixed(1) + '%' : '—').padStart(11)}`);
        console.log(`  参考: 人件費以外÷売上 ${(sales > 0 ? ((nonLabor / sales) * 100).toFixed(1) + '%' : '—').padStart(9)}`);
        console.log(`  参考: 1人工あたり人件費 ${headcount > 0 ? yen(Math.round(b.laborCost / headcount)) + '円' : '—'}`);
        console.log();
    }
}

async function run() {
    try { await main(); } catch (e) { console.error(e); process.exitCode = 1; }
    const { prisma } = await import('../lib/prisma');
    await prisma.$disconnect();
}
run();

export {};
