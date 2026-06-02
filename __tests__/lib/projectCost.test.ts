/**
 * @jest-environment node
 */
import { computeProjectCosts } from '@/lib/projectCost';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: { findMany: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
        vehicle: { findMany: jest.fn() },
        user: { findMany: jest.fn() },
        worker: { findMany: jest.fn() },
        constructionType: { findMany: jest.fn() },
        dailyReportWorkItem: { findMany: jest.fn() },
    },
}));

const D = new Date('2026-06-10T00:00:00.000Z');

describe('lib/projectCost / computeProjectCosts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ laborDailyRate: 18000 });
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('配置の労務上書きを採用し、材料費・その他を加算する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 10000, otherExpenses: 2000, loadingCost: 0, subcontractorCosts: [],
            assignments: [{
                id: 'a1', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                workers: '[]', memberCount: 0, vehicles: '[]',
                laborCostOverride: 50000, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [],
            }],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);

        const r = (await computeProjectCosts(['p1'])).get('p1')!;
        expect(r.breakdown).toMatchObject({ laborCost: 50000, vehicleCost: 0, subcontractorCost: 0, materialCost: 10000, otherExpenses: 2000, totalCost: 62000 });
    });

    it('同じ作業者の同日掛け持ちは全案件の作業時間で按分する（対象が1案件でも正確）', async () => {
        // p1 のみ取得するが、分母には別案件ぶん(同 w1・同日 480分)も含まれる → 18000 × 480/960 = 9000
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [{
                id: 'a1', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                workers: '[]', memberCount: 1, vehicles: '[]',
                laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [
                    { id: 'wi1', startTime: '08:00', endTime: '16:00', breakMinutes: 0, workerIds: ['w1'], dailyReport: { id: 'dr1', date: D } },
                ],
            }],
        }]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([{ id: 'w1', dailyRate: 18000 }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);
        // 分母: w1 はこの日 480(p1)＋480(他案件)＝960 分働いた
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { startTime: '08:00', endTime: '16:00', breakMinutes: 0, workerIds: ['w1'], assignment: { workers: '[]' }, dailyReport: { date: D } },
            { startTime: '08:00', endTime: '16:00', breakMinutes: 0, workerIds: ['w1'], assignment: { workers: '[]' }, dailyReport: { date: D } },
        ]);

        const r = (await computeProjectCosts(['p1'])).get('p1')!;
        expect(r.breakdown.laborCost).toBe(9000);
    });

    it('協力業者(partner)職長の配置は労務に計上せず、外注費を種別ごと初回のみ計上する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0,
            subcontractorCosts: [{ constructionTypeId: 'ct1', amount: 80000, transportCost: 5000 }],
            assignments: [
                {
                    id: 'a1', date: D, assignedEmployeeId: 'partner1', isDispatchConfirmed: true, constructionType: 'ct1',
                    workers: '[]', memberCount: 1, vehicles: '[]',
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [
                        { id: 'wi1', startTime: '08:00', endTime: '17:00', breakMinutes: 0, workerIds: ['w1'], dailyReport: { id: 'dr1', date: D } },
                    ],
                },
                {
                    id: 'a2', date: new Date('2026-06-11T00:00:00.000Z'), assignedEmployeeId: 'partner1', isDispatchConfirmed: true, constructionType: 'ct1',
                    workers: '[]', memberCount: 1, vehicles: '[]',
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [],
                },
            ],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'partner1', displayName: '協力P', role: 'partner' }]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([{ id: 'w1', dailyRate: 18000 }]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([{ id: 'ct1', name: '組立' }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.laborCost).toBe(0);            // partner 配置は労務除外
        expect(r.breakdown.subcontractorCost).toBe(85000); // 80000+5000、種別ごと初回のみ（a2 では重複計上しない）
        expect(r.breakdown.totalCost).toBe(85000);
        // 明細（withDetail）: 労務行は空、外注の実効額合計は 85000（種別初回のみ計上）
        expect(r.detail?.labor).toHaveLength(0);
        expect((r.detail?.subcontractor ?? []).reduce((s, x) => s + x.effectiveCost, 0)).toBe(85000);
    });

    it('該当しない projectId も空原価でキーを返す', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        const map = await computeProjectCosts(['none']);
        expect(map.get('none')!.breakdown.totalCost).toBe(0);
    });
});
