/**
 * @jest-environment node
 */
import { fetchMonthlySales, fetchMonthlyAssigneeBreakdown } from '@/lib/profitDashboard';
import { prisma } from '@/lib/prisma';
import { computeProjectCosts } from '@/lib/projectCost';

// 原価エンジンは projectCost.test.ts で単体検証済み。ここでは結果をモックして売上/グルーピングに集中する。
jest.mock('@/lib/projectCost', () => ({ computeProjectCosts: jest.fn() }));

// projectId → 原価のモックを返すヘルパ。
// costs[id] が number なら全期間原価（cutoffs 指定時も全カットオフ同値＝単月請求の案件相当）、
// 関数なら (cutoff: Date | null) => その時点の累積原価（繰越方式の検証用。null=上限なし）。
const mockCosts = (costs: Record<string, number | ((cutoff: Date | null) => number)> = {}) =>
    (ids: string[], opts?: { cutoffs?: (Date | null)[] }) => new Map(ids.map(id => {
        const c = costs[id] ?? 0;
        const at = (cut: Date | null) => (typeof c === 'function' ? c(cut) : c);
        return [id, {
            breakdown: { laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: at(null) },
            totalsAtCutoffs: opts?.cutoffs?.map(at),
        }];
    }));

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: {
            findMany: jest.fn(),
        },
        estimate: {
            findMany: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
        },
        systemSettings: {
            findFirst: jest.fn(),
        },
        dailyReportWorkItem: {
            findMany: jest.fn(),
        },
        projectAssignment: {
            findMany: jest.fn(),
            groupBy: jest.fn(),
        },
        vehicle: {
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
        worker: {
            findMany: jest.fn(),
        },
        constructionType: {
            findMany: jest.fn(),
        },
        monthlyAssigneeCostOverride: {
            findMany: jest.fn(),
        },
        monthlyProjectCostOverride: {
            findMany: jest.fn(),
        },
    },
}));

describe('lib/profitDashboard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectAssignment.groupBy as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({}));
    });

    describe('fetchMonthlySales', () => {
        // JST 2026-06-15 09:00（= UTC 00:00）。当月=2026年6月、前月=2026年5月。
        const now = new Date('2026-06-15T00:00:00Z');

        it('当月・前月を JST 月で振り分け、前月比を算出する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 100000, createdAt: new Date('2026-06-10T03:00:00Z') }, // JST 6月
                { total: 50000, createdAt: new Date('2026-05-20T03:00:00Z') },  // JST 5月
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.year).toBe(2026);
            expect(r.current.month).toBe(6);
            expect(r.current.sales).toBe(100000);
            expect(r.current.invoiceCount).toBe(1);
            expect(r.previous.month).toBe(5);
            expect(r.previous.sales).toBe(50000);
            expect(r.momDelta).toBe(50000);
            expect(r.momPercent).toBe(100); // (100000-50000)/50000 = +100%
            expect(r.trend).toHaveLength(12);
            // trend は古い→新しい。末尾が当月。
            expect(r.trend[r.trend.length - 1]).toMatchObject({ year: 2026, month: 6, sales: 100000 });
            expect(r.trend[r.trend.length - 2]).toMatchObject({ month: 5, sales: 50000 });
            expect(r.trend[0]).toMatchObject({ year: 2025, month: 7 }); // 12ヶ月前
        });

        it('UTC 月末深夜は JST 翌月（=当月）として集計する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 30000, createdAt: new Date('2026-05-31T15:30:00Z') }, // JST 6/1 00:30 → 6月
                { total: 70000, createdAt: new Date('2026-05-31T14:30:00Z') }, // JST 5/31 23:30 → 5月
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(30000);
            expect(r.previous.sales).toBe(70000);
        });

        it('送付済み以降のみ計上する where 条件と JST 月範囲・税込(total)でクエリする', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            await fetchMonthlySales(12, now);

            expect(prisma.invoice.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { in: ['sent', 'paid', 'overdue'] },
                        createdAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
                    }),
                    // 月次売上は税込（kei 決定 2026-07-07）。担当者別/顧客別内訳は税抜のまま
                    select: { total: true, createdAt: true },
                }),
            );
            // lt は翌月初(JST) = 2026-07-01 00:00 JST = 2026-06-30T15:00:00Z
            const arg = (prisma.invoice.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.where.createdAt.lt.toISOString()).toBe('2026-06-30T15:00:00.000Z');
            // gte は11ヶ月前の月初(JST) = 2025-07-01 00:00 JST = 2025-06-30T15:00:00Z
            expect(arg.where.createdAt.gte.toISOString()).toBe('2025-06-30T15:00:00.000Z');
        });

        it('前月が 0 のとき momPercent は null', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 80000, createdAt: new Date('2026-06-05T03:00:00Z') },
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(80000);
            expect(r.previous.sales).toBe(0);
            expect(r.momDelta).toBe(80000);
            expect(r.momPercent).toBeNull();
        });

        it('請求書が無ければすべて 0・momPercent は null', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(0);
            expect(r.previous.sales).toBe(0);
            expect(r.momPercent).toBeNull();
            expect(r.trend).toHaveLength(12);
            expect(r.trend.every(p => p.sales === 0 && p.invoiceCount === 0)).toBe(true);
        });
    });

    describe('fetchMonthlyAssigneeBreakdown', () => {
        beforeEach(() => {
            // 既定は全部空。原価は computeProjectCosts をモック（既定 0）。
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({}));
        });

        it('案件の売上を主担当へ全額計上する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1', createdAt: new Date('2026-06-10T00:00:00Z') },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' }]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: 'u1', name: '担当A', sales: 100000, cost: 0, grossProfit: 100000 });
            // 案件明細（展開時に見える行）
            expect(r.rows[0].items).toHaveLength(1);
            expect(r.rows[0].items[0]).toMatchObject({ projectId: 'p1', projectName: '案件1', sales: 100000, cost: 0 });
            expect(r.totals).toEqual({ sales: 100000, salesTaxIncluded: 0, cost: 0, grossProfit: 100000 });
        });

        it('複数案件まとめ請求は明細額で按分し、各案件の主担当へ計上する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":30000},{"projectMasterId":"p2","amount":70000}]', projectMasterId: 'p1', createdAt: new Date('2026-06-10T00:00:00Z') },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                { id: 'p1', createdBy: '["u1"]' },
                { id: 'p2', createdBy: '["u2"]' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' },
                { id: 'u2', displayName: '担当B', dailyRate: null, role: 'manager' },
            ]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            const byId = Object.fromEntries(r.rows.map(x => [x.key, x.sales]));
            expect(byId['u1']).toBe(30000);
            expect(byId['u2']).toBe(70000);
            expect(r.totals.sales).toBe(100000);
        });

        it('案件の確定原価（computeProjectCosts）を主担当に集約する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1', createdAt: new Date('2026-06-10T00:00:00Z') },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
            // 原価は共通エンジンの確定値（人件費＋車両費＋材料費＋外注費＋その他）
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({ p1: 25000 }));

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: 'u1', sales: 100000, cost: 25000, grossProfit: 75000 });
            // 単月請求＝その月が最新請求月 → 上限なし(null)の1カットオフ・減算なし＝総原価そのまま
            expect(computeProjectCosts).toHaveBeenCalledWith(['p1'], { cutoffs: [null] });
        });

        it('担当者・案件のない請求は「未設定」バケットへ集約する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 50000, items: '[]', projectMasterId: null, createdAt: new Date('2026-06-10T00:00:00Z') },
            ]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: '__unassigned__', name: '(担当者未設定)', sales: 50000 });
        });

        it('顧客別に集計できる（axis=customer・案件名は正式名称＋顧客名）', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1', createdAt: new Date('2026-06-10T00:00:00Z') },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                { id: 'p1', createdBy: '["u1"]', name: '佐藤', title: '佐藤様邸 仮設工事', customerName: '佐藤建設' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' }]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6, axis: 'customer' });

            expect(r.axis).toBe('customer');
            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: '佐藤建設', name: '佐藤建設', sales: 100000 });
            // 案件名は title（敬称・工事名称込み）＋顧客名を保持
            expect(r.rows[0].items[0]).toMatchObject({ projectName: '佐藤様邸 仮設工事', customerName: '佐藤建設' });
        });

        it('年間(period=year)は当年に請求のあった案件を集計する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 200000, items: '[{"projectMasterId":"p1","amount":180000}]', projectMasterId: 'p1', createdAt: new Date('2026-03-10T00:00:00Z') },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1', customerName: '顧客X' }]);
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({ p1: 40000 }));

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6, period: 'year' });

            expect(r.period).toBe('year');
            const u1 = r.rows.find(x => x.key === 'u1')!;
            expect(u1.sales).toBe(200000);
            expect(u1.cost).toBe(40000);
        });

        describe('繰越方式（分割請求の原価は累積差分で二重計上しない）', () => {
            // JST 月末の排他上限（= 翌月1日 JST 00:00）
            const endOfMay = new Date(Date.UTC(2026, 5, 1, -9, 0, 0, 0));   // 2026-05-31T15:00:00Z
            const endOfDec2025 = new Date(Date.UTC(2025, 12, 1, -9, 0, 0, 0)); // 2025-12-31T15:00:00Z

            // 松本様邸パターン: 5月請求201,000＋6月請求105,000、総原価151,100（うち5月末までの発生121,100）
            const splitInvoices = [
                { subtotal: 201000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2026-05-15T00:00:00Z') },
                { subtotal: 105000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2026-06-15T00:00:00Z') },
            ];
            const splitCosts = mockCosts({
                p1: (cut: Date | null) => (cut === null ? 151100 : (cut.getTime() === endOfMay.getTime() ? 121100 : 0)),
            });
            const setupSplit = () => {
                (prisma.invoice.findMany as jest.Mock).mockResolvedValue(splitInvoices);
                (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '松本様邸', title: '松本様邸' }]);
                (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
                (computeProjectCosts as jest.Mock).mockImplementation(splitCosts);
            };

            it('過去の請求月は「その月末までの累積 − 直前請求月末までの累積」…初月は減算なし', async () => {
                setupSplit();
                const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 5 });
                // 5月は最新請求月(6月)ではない → upper=5月末。直前請求月なし → 減算なし → 121,100
                expect(r.rows[0]).toMatchObject({ sales: 201000, cost: 121100, grossProfit: 79900 });
                expect(computeProjectCosts).toHaveBeenCalledWith(['p1'], { cutoffs: [endOfMay] });
            });

            it('最新請求月は上限なし（請求後に発生した原価も取りこぼさない）− 直前請求月末までの累積', async () => {
                setupSplit();
                const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });
                // 6月=最新請求月 → upper=null(∞)=151,100。lower=5月末=121,100 → 30,000
                expect(r.rows[0]).toMatchObject({ sales: 105000, cost: 30000, grossProfit: 75000 });
                expect(computeProjectCosts).toHaveBeenCalledWith(['p1'], { cutoffs: [null, endOfMay] });
            });

            it('全請求月の原価合計＝案件の総原価（望遠鏡和・松本様邸の粗利154,900が再現される）', async () => {
                setupSplit();
                const may = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 5 });
                setupSplit();
                const june = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });
                expect(may.totals.cost + june.totals.cost).toBe(151100);
                expect(may.totals.grossProfit + june.totals.grossProfit).toBe(154900);
            });

            it('period=range は任意の月範囲で集計し、範囲全体の売上・原価を合算する', async () => {
                // 5月・6月の分割請求を 5〜6月の範囲でまとめて見る → 売上306,000・原価=C(∞)全額
                (prisma.invoice.findMany as jest.Mock).mockResolvedValue(splitInvoices);
                (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '松本様邸', title: '松本様邸' }]);
                (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
                (computeProjectCosts as jest.Mock).mockImplementation(splitCosts);

                const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 5, period: 'range', endYear: 2026, endMonth: 6 });

                expect(r.period).toBe('range');
                expect(r.endYear).toBe(2026);
                expect(r.endMonth).toBe(6);
                // 範囲内最終請求月(6月)=最新請求月 → C(∞)。範囲前の請求なし → 減算なし
                expect(r.rows[0]).toMatchObject({ sales: 306000, cost: 151100, grossProfit: 154900 });
            });

            it('totals.salesTaxIncluded は期間内請求書の total(税込) 合計（案件なし請求も含む）', async () => {
                (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                    { subtotal: 100000, total: 110000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2026-06-10T00:00:00Z') },
                    { subtotal: 50000, total: 55000, items: '[]', projectMasterId: null, createdAt: new Date('2026-06-20T00:00:00Z') },
                    // 期間外（5月）は税込合計に含めない
                    { subtotal: 30000, total: 33000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2026-05-10T00:00:00Z') },
                ]);
                (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
                (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);

                const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

                expect(r.totals.salesTaxIncluded).toBe(165000); // 110000+55000（税抜 totals.sales=150000 とは別物）
                expect(r.totals.sales).toBe(150000);
            });

            it('年間ビューは「年内最終請求月まで − 年より前の最終請求月まで」の差分（年跨ぎ分割）', async () => {
                (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                    { subtotal: 100000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2025-12-10T00:00:00Z') },
                    { subtotal: 50000, items: '[]', projectMasterId: 'p1', createdAt: new Date('2026-03-10T00:00:00Z') },
                ]);
                (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
                (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
                (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({
                    p1: (cut: Date | null) => (cut === null ? 80000 : (cut.getTime() === endOfDec2025.getTime() ? 30000 : 0)),
                }));

                const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6, period: 'year' });
                // 2026年の売上は3月分のみ。原価 = C(∞・3月が最新請求月) − C(2025年12月末) = 80,000 − 30,000
                expect(r.rows[0]).toMatchObject({ sales: 50000, cost: 50000, grossProfit: 0 });
            });
        });
    });
});
