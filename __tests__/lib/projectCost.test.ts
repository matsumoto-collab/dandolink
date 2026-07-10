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
        partnerWorkVolume: { findMany: jest.fn() },
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
        (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([]);
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

    it('外注費の手入力分(subcontractorExpense)を協力業者の自動計上に加算する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorExpense: 30000,
            subcontractorCosts: [{ constructionTypeId: 'ct1', amount: 80000, transportCost: 0 }],
            assignments: [{
                id: 'a1', date: D, assignedEmployeeId: 'partner1', isDispatchConfirmed: true, constructionType: 'ct1',
                workers: '[]', memberCount: 1, vehicles: '[]',
                laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                dailyReportWorkItems: [],
            }],
        }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'partner1', displayName: '協力P', role: 'PARTNER' }]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([{ id: 'ct1', name: '組立' }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.subcontractorCost).toBe(110000); // 自動80000 + 手入力30000
        expect(r.breakdown.totalCost).toBe(110000);
        expect(r.detail?.subcontractorExpense).toBe(30000); // detail は手入力分のみ
        expect((r.detail?.subcontractor ?? []).reduce((s, x) => s + x.effectiveCost, 0)).toBe(80000); // 明細行は自動分のみ
    });

    it('協力業者の配置が無くても外注費の手入力分だけで計上できる', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorExpense: 50000,
            subcontractorCosts: [], assignments: [],
        }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.subcontractorCost).toBe(50000);
        expect(r.breakdown.totalCost).toBe(50000);
        expect(r.detail?.subcontractorExpense).toBe(50000);
        expect(r.detail?.subcontractor).toHaveLength(0); // 自動計上明細は無し（手入力のみ）
    });

    it('manualCostItems の明細から全6項目の手入力分を計算し、自動計上に加算する', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: null, otherExpenses: null, loadingCost: null, subcontractorExpense: null,
            manualCostItems: {
                labor: [{ label: '5月応援', amount: 30000 }],
                vehicle: [{ label: 'レンタカー', amount: 10000 }],
                material: [{ label: '鋼材', amount: 5000 }, { label: 'ボルト', amount: 2000 }],
                loading: [],
                other: [{ label: '雑費', amount: 1000 }],
                subcontractor: [{ label: '6月請求', amount: 80000 }],
            },
            subcontractorCosts: [], assignments: [],
        }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.laborCost).toBe(30000);
        expect(r.breakdown.vehicleCost).toBe(10000);
        expect(r.breakdown.materialCost).toBe(7000);   // 5000+2000
        expect(r.breakdown.otherExpenses).toBe(1000);
        expect(r.breakdown.subcontractorCost).toBe(80000);
        expect(r.breakdown.totalCost).toBe(128000);    // 30000+10000+7000+0+1000+80000
        expect(r.detail?.manualItems.material).toHaveLength(2);
        expect(r.detail?.manualItems.labor[0].label).toBe('5月応援');
    });

    it('manualCostItems が無い案件は旧スカラー列(materialCost等)を後方互換で使う', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', materialCost: 12000, otherExpenses: 3000, loadingCost: 0, subcontractorExpense: 0,
            manualCostItems: null,
            subcontractorCosts: [], assignments: [],
        }]);

        const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
        expect(r.breakdown.materialCost).toBe(12000);
        expect(r.breakdown.otherExpenses).toBe(3000);
        // 旧スカラーは detail で1件の明細(label空)として見せる（UIの初期値になる）
        expect(r.detail?.manualItems.material).toEqual([{ label: '', amount: 12000 }]);
        expect(r.detail?.manualItems.loading).toEqual([]);
    });

    it('該当しない projectId も空原価でキーを返す', async () => {
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        const map = await computeProjectCosts(['none']);
        expect(map.get('none')!.breakdown.totalCost).toBe(0);
    });

    describe('cutoffs: カットオフ時点ごとの累積総原価（月次内訳の繰越方式用）', () => {
        // JST 2026-06-01 00:00（=5月末の排他上限）。null は上限なし。
        const endOfMay = new Date(Date.UTC(2026, 5, 1, -9, 0, 0, 0));

        it('配置由来の原価は配置日でカットオフに振り分け、日付なしの旧スカラーは全カットオフに含む', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
                id: 'p1', materialCost: 1000, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [],
                assignments: [
                    {
                        id: 'a1', date: new Date('2026-05-10T00:00:00.000Z'), assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                        workers: '[]', memberCount: 0, vehicles: '[]',
                        laborCostOverride: 5000, vehicleCostOverride: null, subcontractorCostOverride: null,
                        dailyReportWorkItems: [],
                    },
                    {
                        id: 'a2', date: new Date('2026-06-10T00:00:00.000Z'), assignedEmployeeId: 'f1', isDispatchConfirmed: false, constructionType: null,
                        workers: '[]', memberCount: 0, vehicles: '[]',
                        laborCostOverride: 7000, vehicleCostOverride: null, subcontractorCostOverride: null,
                        dailyReportWorkItems: [],
                    },
                ],
            }]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'f1', displayName: 'F', role: 'manager' }]);

            const r = (await computeProjectCosts(['p1'], { cutoffs: [endOfMay, null] })).get('p1')!;
            // 5月末まで: a1(5000)＋旧スカラー材料費(日付なし=常に含む1000)。上限なし: a2(7000)も加算
            expect(r.totalsAtCutoffs).toEqual([6000, 13000]);
            expect(r.breakdown.totalCost).toBe(13000); // breakdown は従来どおり全期間
        });

        it('仕入請求書配分は issueDate で振り分け、発行日なしは全カットオフに含む', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
                id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0, subcontractorCosts: [], assignments: [],
                purchaseInvoiceAllocations: [
                    { amount: 5000, expenseCategory: { name: '材料費', costBucket: 'material' }, purchaseInvoice: { id: 'pi1', payeeName: 'A', issueDate: new Date('2026-06-05T00:00:00.000Z') } },
                    { amount: 3000, expenseCategory: { name: '雑費', costBucket: 'other' }, purchaseInvoice: { id: 'pi2', payeeName: 'B', issueDate: null } },
                ],
            }]);

            const r = (await computeProjectCosts(['p1'], { cutoffs: [endOfMay, null] })).get('p1')!;
            expect(r.totalsAtCutoffs).toEqual([3000, 8000]); // 発行日なし3000は5月末カットオフにも含む
        });

        it('手入力明細は date で振り分け（境界: 5/31は5月・6/1は6月）、日付なし明細は全カットオフに含む', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
                id: 'p1', materialCost: null, otherExpenses: null, loadingCost: null, subcontractorExpense: null,
                manualCostItems: {
                    material: [
                        { label: '5月末シート', amount: 2000, date: '2026-05-31' },
                        { label: '6月頭ボルト', amount: 3000, date: '2026-06-01' },
                        { label: '日付なし', amount: 100 },
                    ],
                },
                subcontractorCosts: [], assignments: [],
            }]);

            const r = (await computeProjectCosts(['p1'], { cutoffs: [endOfMay, null], withDetail: true })).get('p1')!;
            expect(r.totalsAtCutoffs).toEqual([2100, 5100]);
            // detail の明細に date が残る（UIの編集初期値）
            expect(r.detail?.manualItems.material.find(it => it.label === '5月末シート')?.date).toBe('2026-05-31');
            expect(r.detail?.manualItems.material.find(it => it.label === '日付なし')?.date).toBeUndefined();
        });

        it('該当しない projectId は totalsAtCutoffs も 0 で埋める。cutoffs 未指定なら undefined', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            const withCuts = await computeProjectCosts(['none'], { cutoffs: [endOfMay, null] });
            expect(withCuts.get('none')!.totalsAtCutoffs).toEqual([0, 0]);
            const without = await computeProjectCosts(['none']);
            expect(without.get('none')!.totalsAtCutoffs).toBeUndefined();
        });
    });

    describe('協力業者出来高で確定した金額を外注費へ反映する', () => {
        const D2 = new Date('2026-06-11T00:00:00.000Z');
        // 予定単価: 作業費80000＋運搬費5000。partner職長の確定済み配置 a1(6/10)・a2(6/11)＝種別ごと初回のみ計上
        const partnerPm = (a1Extra: Record<string, unknown> = {}) => ({
            id: 'p1', materialCost: 0, otherExpenses: 0, loadingCost: 0,
            subcontractorCosts: [{ constructionTypeId: 'ct1', amount: 80000, transportCost: 5000 }],
            assignments: [
                {
                    id: 'a1', date: D, assignedEmployeeId: 'partner1', isDispatchConfirmed: true, constructionType: 'ct1',
                    workers: '[]', memberCount: 1, vehicles: '[]',
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [], ...a1Extra,
                },
                {
                    id: 'a2', date: D2, assignedEmployeeId: 'partner1', isDispatchConfirmed: true, constructionType: 'ct1',
                    workers: '[]', memberCount: 1, vehicles: '[]',
                    laborCostOverride: null, vehicleCostOverride: null, subcontractorCostOverride: null,
                    dailyReportWorkItems: [],
                },
            ],
        });
        beforeEach(() => {
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'partner1', displayName: '協力P', role: 'PARTNER' }]);
            (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([{ id: 'ct1', name: '組立' }]);
        });

        it('出来高で金額編集された行はその金額を採用する（未編集の運搬費分は予定額のまま）', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm()]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 70000, amountOverridden: true, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
            expect(r.breakdown.subcontractorCost).toBe(75000); // 作業費70000(出来高) + 運搬費5000(予定)
            const a1 = r.detail!.subcontractor.find(x => x.assignmentId === 'a1')!;
            expect(a1.fromVolume).toBe(true);
            expect(a1.effectiveCost).toBe(75000);
        });

        it('出来高で削除された行は支払い対象外(0円)として扱う', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm()]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 80000, amountOverridden: false, deletedAt: new Date('2026-06-30T00:00:00.000Z') },
                { sourceAssignmentId: 'a1', rowType: 'transport', partnerCompanyId: 'partner1', amount: 5000, amountOverridden: false, deletedAt: new Date('2026-06-30T00:00:00.000Z') },
            ]);
            const r = (await computeProjectCosts(['p1'])).get('p1')!;
            expect(r.breakdown.subcontractorCost).toBe(0); // 代表(a1)の予定額は削除で0円、a2は非代表で元々0
        });

        it('自動額のまま保存された行(完了操作のみ・amount=0)は従来どおり予定額で計上する', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm()]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 0, amountOverridden: false, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'], { withDetail: true })).get('p1')!;
            expect(r.breakdown.subcontractorCost).toBe(85000); // 80000+5000（種別ごと初回・従来どおり）
            expect(r.detail!.subcontractor.find(x => x.assignmentId === 'a1')!.fromVolume).toBe(false);
        });

        it('出来高で明示的に0円にした行(amountOverridden)は0円を採用する', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm()]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 0, amountOverridden: true, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'])).get('p1')!;
            expect(r.breakdown.subcontractorCost).toBe(5000); // 作業費0円(明示) + 運搬費5000(予定)
        });

        it('配置ごとの上書き(subcontractorCostOverride)より出来高の確定金額を優先する', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                partnerPm({ subcontractorCostOverride: 60000 }),
            ]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 70000, amountOverridden: true, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'])).get('p1')!;
            // 上書きは総額を作業費側に集約する既存仕様（運搬費側0）→ 作業費は出来高70000が上書き60000より優先
            expect(r.breakdown.subcontractorCost).toBe(70000);
        });

        it('行の会社と現在の職長が異なる残骸行は反映しない（職長を別の協力業者へ変更したケース）', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm()]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'partner1', displayName: '協力P', role: 'PARTNER' },
                { id: 'partner2', displayName: '協力Q', role: 'PARTNER' },
            ]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                // 職長が partner2 → partner1 に変わる前に保存された古い行
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner2', amount: 99000, amountOverridden: true, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'])).get('p1')!;
            expect(r.breakdown.subcontractorCost).toBe(85000); // 残骸99000は無視し、予定額80000+5000のまま
        });

        it('職長が協力業者でなくなった配置の残骸行は反映しない（自社班へ変更・常用化したケース）', async () => {
            // 実例: 出来高画面では常用(joyo)行に置き換わり非表示になる残骸 work 行が draft のまま残る
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([partnerPm({ assignedEmployeeId: 'foreman1' })]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'partner1', displayName: '協力P', role: 'PARTNER' },
                { id: 'foreman1', displayName: '自社職長', role: 'FOREMAN2' },
            ]);
            (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([
                { sourceAssignmentId: 'a1', rowType: 'work', partnerCompanyId: 'partner1', amount: 302400, amountOverridden: false, deletedAt: null },
            ]);
            const r = (await computeProjectCosts(['p1'])).get('p1')!;
            // a1(自社職長)は外注費対象外＝残骸302400を拾わない。a2(partner1)が種別代表になり予定額85000を計上
            expect(r.breakdown.subcontractorCost).toBe(85000);
        });
    });
});
