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
        // 本番DBは role が大文字(PARTNER)で入るため、大文字でも partner と判定できることを保証
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'partner1', displayName: '協力P', role: 'PARTNER' }]);
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

    it('車両費: 手配確定後のみ計上（未確定は0、確定済みはconfirmedVehicleIds、上書きはゲートを貫通）', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([
            { id: 'v1', name: '軽トラ', dailyRate: 3000 },
            { id: 'v2', name: '2tダンプ', dailyRate: 5000 },
        ]);
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [
                // 未確定: 計画車両があっても車両費は0
                {
                    id: 'a1', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                    workers: '[]', memberCount: 0, vehicles: '["軽トラ","2tダンプ"]', confirmedVehicleIds: null,
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [],
                },
                // 確定済み: confirmedVehicleIds(v1=3000)で計上
                {
                    id: 'a2', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: true, constructionType: null,
                    workers: '[]', memberCount: 0, vehicles: '["2tダンプ"]', confirmedVehicleIds: '["v1"]',
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [],
                },
                // 未確定でも手動上書きは有効（5000計上）
                {
                    id: 'a3', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                    workers: '[]', memberCount: 0, vehicles: '[]', confirmedVehicleIds: null,
                    laborCostOverride: null, vehicleCostOverride: 5000, subcontractorCostOverride: null,
                    dailyReportWorkItems: [],
                },
            ],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.vehicleCost).toBe(0 + 3000 + 5000); // 未確定0 + 確定3000 + 上書き5000
        // 明細の車両名は確定済みa2のみ（軽トラ）。未確定a1は行なし
        const allNames = (r.detail?.vehicle ?? []).flatMap(v => v.vehicleNames);
        expect(allNames).toEqual(['軽トラ']);
    });

    it('明細の日付は配置日をJSTで表示する（UTC夜間タイムスタンプでも前日にズレない）', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [{
                id: 'a1', date: new Date('2026-05-14T23:32:35.268Z'), assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                workers: '[]', memberCount: 0, vehicles: '[]', confirmedVehicleIds: null,
                laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [],
            }],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.detail?.labor[0].date).toBe('2026-05-15'); // JST。UTCスライスだと 2026-05-14 になってしまう
    });

    it('配置移動(リスケ)で別日に残った空明細(0名)は原価に二重計上しない', async () => {
        const real = { id: 'wi-real', startTime: '08:00', endTime: '16:30', breakMinutes: 0, workerIds: ['w1', 'w2', 'w3', 'w4', 'w5'], dailyReport: { id: 'dr15', date: new Date('2026-05-15T00:00:00.000Z') } };
        const orphan = { id: 'wi-orphan', startTime: '08:00', endTime: '16:30', breakMinutes: 0, workerIds: [], dailyReport: { id: 'dr14', date: new Date('2026-05-14T00:00:00.000Z') } };
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [{
                id: 'a1', date: new Date('2026-05-14T23:32:35.268Z'), assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                workers: '[]', memberCount: 5, vehicles: '[]', confirmedVehicleIds: null,
                laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [real, orphan],
            }],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue(['w1', 'w2', 'w3', 'w4', 'w5'].map(id => ({ id, dailyRate: 18000 })));
        // 分母: 5名はいずれも 5/15 に 510分だけ稼働（満額×5＝90,000になる想定）
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { startTime: '08:00', endTime: '16:30', breakMinutes: 0, workerIds: ['w1', 'w2', 'w3', 'w4', 'w5'], assignment: { workers: '[]' }, dailyReport: { date: new Date('2026-05-15T00:00:00.000Z') } },
        ]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.laborCost).toBe(90000); // 空明細(5/14)を除外し、5名×18000のみ
        expect(r.detail?.labor[0].hours).toBe(8.5); // 17hにならない
    });

    it('日報に作業者が無いときは手配確定メンバー＋職長で人件費を算出（按分・正確人数）', async () => {
        // memberCount=0 でも 確定メンバー[m1,m2]＋職長f1 の3名で計上（=従来の1名合成より正確）
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [{
                id: 'a1', date: D, assignedEmployeeId: 'f1', isDispatchConfirmed: true, constructionType: null,
                workers: '[]', memberCount: 0, vehicles: '[]', confirmedVehicleIds: null, confirmedWorkerIds: '["m1","m2"]',
                laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [
                    { id: 'wi1', startTime: '08:00', endTime: '17:00', breakMinutes: 0, workerIds: [], dailyReport: { id: 'dr1', date: D } },
                ],
            }],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([
            { id: 'f1', displayName: 'F', role: 'manager', dailyRate: 18000 },
            { id: 'm1', displayName: 'M1', role: 'worker', dailyRate: 18000 },
            { id: 'm2', displayName: 'M2', role: 'worker', dailyRate: 18000 },
        ]);
        // 分母: m1,m2,f1 はこの日 540分だけ稼働（満額×3＝54,000）
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { startTime: '08:00', endTime: '17:00', breakMinutes: 0, workerIds: [], assignment: { workers: '[]', confirmedWorkerIds: '["m1","m2"]', assignedEmployeeId: 'f1' }, dailyReport: { date: D } },
        ]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.laborCost).toBe(54000); // 3名×18000。memberCount=0でも1名にならない
        expect(r.detail?.labor[0].workerCount).toBe(3); // 表示人数=実計上人数(確定メンバー2＋職長1)。a.memberCount(0)ではない
    });

    it('確定済み仕入請求書の案件配分を費目バケットごとに原価へ加算する（手入力分と合算）', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 1000, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
            assignments: [],
            // 1枚を複数案件へ按分した配分のうち p1 ぶん（material/loading/other の3行）
            purchaseInvoiceAllocations: [
                { amount: 5000, expenseCategory: { name: '材料費', costBucket: 'material' }, purchaseInvoice: { id: 'pi1', payeeName: '資材店', issueDate: D } },
                { amount: 3000, expenseCategory: { name: 'リース', costBucket: 'loading' }, purchaseInvoice: { id: 'pi1', payeeName: '資材店', issueDate: D } },
                { amount: 2000, expenseCategory: { name: '雑費', costBucket: 'other' }, purchaseInvoice: { id: 'pi2', payeeName: 'その他社', issueDate: D } },
            ],
        }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        // material=手入力1000+請求書5000、loading=請求書3000、other=請求書2000
        expect(r.breakdown).toMatchObject({ materialCost: 6000, loadingCost: 3000, otherExpenses: 2000, totalCost: 11000 });
        // detail.materialCost は手入力分のみ（請求書分は purchaseInvoices 明細で見せる）
        expect(r.detail?.materialCost).toBe(1000);
        expect(r.detail?.purchaseInvoices).toHaveLength(3);
        expect((r.detail?.purchaseInvoices ?? []).reduce((s, x) => s + x.amount, 0)).toBe(10000);
    });

    it('該当しない projectId も空原価でキーを返す', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        const map = await computeProjectCosts(['none']);
        expect(map.get('none')!.breakdown.totalCost).toBe(0);
    });
});
