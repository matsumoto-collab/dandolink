/**
 * @jest-environment node
 */
import { POST } from '@/app/api/project-masters/export-costs/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { NextRequest } from 'next/server';

jest.mock('@/lib/projectCost', () => ({
    computeProjectCosts: jest.fn(),
}));

const managerSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

/** breakdown の作りやすいヘルパ（未指定は0）。 */
const breakdown = (over: Partial<Record<string, number>> = {}) => ({
    laborCost: 0, loadingCost: 0, vehicleCost: 0,
    materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
    ...over,
});

/** computeProjectCosts のモック戻り値（withDetail: true 相当）。 */
const costResult = (
    entries: Array<[string, { breakdown: ReturnType<typeof breakdown>; labor?: Array<{ hours: number; workerCount: number }> }]>,
) => new Map(entries.map(([id, v]) => [id, {
    breakdown: v.breakdown,
    detail: {
        labor: (v.labor ?? []).map((l, i) => ({
            assignmentId: `a-${id}-${i}`, date: '2026-05-01', constructionTypeName: '組立',
            hours: l.hours, foremanName: null, workerCount: l.workerCount,
            autoCost: 0, override: null, effectiveCost: 0,
        })),
        vehicle: [], subcontractor: [],
        materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorExpense: 0,
        manualItems: { labor: [], vehicle: [], material: [], loading: [], other: [], subcontractor: [] },
        purchaseInvoices: [],
    },
}]));

const post = (body: unknown) =>
    POST(new NextRequest('http://localhost/api/project-masters/export-costs', {
        method: 'POST',
        body: JSON.stringify(body),
    }));

describe('/api/project-masters/export-costs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: managerSession, error: null });
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(new Map());
    });

    it('未認証なら requireAuth のエラーレスポンスをそのまま返す', async () => {
        const unauthorized = new Response(JSON.stringify({ error: '認証が必要です' }), { status: 401 });
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: unauthorized });

        const res = await post({ ids: ['pm-1'] });
        expect(res.status).toBe(401);
        expect(prisma.projectMaster.findMany).not.toHaveBeenCalled();
    });

    it('admin / manager 以外は 403', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'u-9', role: 'worker', isActive: true } }, error: null,
        });

        const res = await post({ ids: ['pm-1'] });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: '権限がありません' });
        expect(computeProjectCosts).not.toHaveBeenCalled();
    });

    it('ids が無い・配列でない・空配列なら 400', async () => {
        expect((await post({})).status).toBe(400);
        expect((await post({ ids: 'pm-1' })).status).toBe(400);
        expect((await post({ ids: [] })).status).toBe(400);
        expect(computeProjectCosts).not.toHaveBeenCalled();
    });

    it('上限（2000件）を超えたら 400', async () => {
        const ids = Array.from({ length: 2001 }, (_, i) => `pm-${i}`);
        const res = await post({ ids });
        expect(res.status).toBe(400);
        expect(computeProjectCosts).not.toHaveBeenCalled();
    });

    it('重複ID・空文字は落としてから問い合わせる', async () => {
        await post({ ids: ['pm-1', 'pm-1', 'pm-2', ''] });
        expect(computeProjectCosts).toHaveBeenCalledWith(['pm-1', 'pm-2'], { withDetail: true });
    });

    it('売上は 手動上書き → 請求済み → 契約金額 → 見積 の順で決まる', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            { id: 'pm-override', contractAmount: 500000, revenueOverride: 123456 },
            { id: 'pm-invoice', contractAmount: 500000, revenueOverride: null },
            { id: 'pm-contract', contractAmount: 500000, revenueOverride: null },
            { id: 'pm-estimate', contractAmount: 0, revenueOverride: null },
            { id: 'pm-none', contractAmount: 0, revenueOverride: null },
        ]);
        // 上位の根拠がある案件にもわざと見積・請求を持たせて優先順を見る
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
            { projectMasterId: 'pm-override', subtotal: 700000 },
            { projectMasterId: 'pm-invoice', subtotal: 700000 },
            { projectMasterId: 'pm-estimate', subtotal: 300000 },
            { projectMasterId: 'pm-estimate', subtotal: 40000 }, // 追加見積は合算
        ]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            { subtotal: 800000, items: null, projectMasterId: 'pm-override' },
            { subtotal: 800000, items: null, projectMasterId: 'pm-invoice' },
        ]);

        const res = await post({ ids: ['pm-override', 'pm-invoice', 'pm-contract', 'pm-estimate', 'pm-none'] });
        expect(res.status).toBe(200);
        const { data } = await res.json();
        const byId = Object.fromEntries(data.map((r: { id: string }) => [r.id, r]));

        expect(byId['pm-override']).toMatchObject({ revenue: 123456, revenueSource: 'override' });
        expect(byId['pm-invoice']).toMatchObject({ revenue: 800000, revenueSource: 'invoice' });
        // 利益タブは見積が先だが、案件CSVは契約金額が先（kei 指定）
        expect(byId['pm-contract']).toMatchObject({ revenue: 500000, revenueSource: 'contract' });
        expect(byId['pm-estimate']).toMatchObject({ revenue: 340000, revenueSource: 'estimate' });
        expect(byId['pm-none']).toMatchObject({ revenue: 0, revenueSource: 'none' });
    });

    it('まとめ請求は明細タグの金額シェアで按分する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            { id: 'pm-1', contractAmount: 0, revenueOverride: null },
            { id: 'pm-2', contractAmount: 0, revenueOverride: null },
        ]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            {
                // 税抜 1,000,000 を pm-1:pm-2 = 3:1 で按分。代表(pm-9)は ids 外なので捨てる
                subtotal: 1000000,
                items: JSON.stringify([
                    { projectMasterId: 'pm-1', amount: 600000 },
                    { projectMasterId: 'pm-2', amount: 200000 },
                ]),
                projectMasterId: 'pm-9',
            },
            // 案件タグ無し＝代表案件に全額
            { subtotal: 100000, items: null, projectMasterId: 'pm-2' },
        ]);

        const res = await post({ ids: ['pm-1', 'pm-2'] });
        const { data } = await res.json();
        const byId = Object.fromEntries(data.map((r: { id: string }) => [r.id, r]));

        expect(byId['pm-1']).toMatchObject({ revenue: 750000, revenueSource: 'invoice' });
        expect(byId['pm-2']).toMatchObject({ revenue: 350000, revenueSource: 'invoice' });
    });

    it('原価は原価エンジンの breakdown をそのまま返し、人時・人日を集計する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            { id: 'pm-1', contractAmount: 1000000, revenueOverride: null },
        ]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult([
            ['pm-1', {
                breakdown: breakdown({
                    laborCost: 300000, vehicleCost: 20000, materialCost: 50000,
                    loadingCost: 30000, subcontractorCost: 200000, otherExpenses: 10000, totalCost: 610000,
                }),
                // 8.0h×3人 + 7.5h×2人 = 24 + 15 = 39人時 / 5人日
                labor: [{ hours: 8, workerCount: 3 }, { hours: 7.5, workerCount: 2 }],
            }],
        ]));

        const res = await post({ ids: ['pm-1'] });
        const { data } = await res.json();
        expect(data[0]).toEqual({
            id: 'pm-1',
            revenue: 1000000,
            revenueSource: 'contract',
            subcontractorCost: 200000,
            materialCost: 50000,
            loadingCost: 30000,
            laborCost: 300000,
            vehicleCost: 20000,
            otherExpenses: 10000,
            totalCost: 610000,
            laborHours: 39,
            laborManDays: 5,
            // 一人当たりの稼ぎ（CSV の金額列と一緒に返す）。中身は valueAdded.test.ts で固定している
            valueAdded: expect.objectContaining({ laborCost: 300000, headcount: 5 }),
        });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('原価エンジンに結果が無い案件は 0 で返す', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            { id: 'pm-1', contractAmount: 0, revenueOverride: null },
        ]);

        const { data } = await (await post({ ids: ['pm-1'] })).json();
        expect(data[0]).toMatchObject({ totalCost: 0, laborHours: 0, laborManDays: 0, revenueSource: 'none' });
    });

    it('削除済みなど DB に無い案件は返さない', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            { id: 'pm-1', contractAmount: 0, revenueOverride: null },
        ]);

        const { data } = await (await post({ ids: ['pm-1', 'pm-deleted'] })).json();
        expect(data.map((r: { id: string }) => r.id)).toEqual(['pm-1']);
    });
});
