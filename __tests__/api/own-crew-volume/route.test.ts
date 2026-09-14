/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET } from '@/app/api/own-crew-volume/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg: string, error: unknown) =>
        NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
}));

// 原価エンジンは lib 側で単体検証済み。ここは取得と受け渡しの配線だけを見る
jest.mock('@/lib/projectCost', () => ({ computeProjectCosts: jest.fn() }));
jest.mock('@/lib/valueAddedSettings', () => ({
    loadValueAddedSettings: jest.fn().mockResolvedValue({
        ...jest.requireActual('@/lib/valueAdded').DEFAULT_VALUE_ADDED_SETTINGS,
        breakevenPerManday: 40000,
    }),
}));

const req = (qs: string) => new NextRequest(`http://localhost/api/own-crew-volume?${qs}`);

const laborRow = (over: Partial<Record<string, unknown>> = {}) => ({
    assignmentId: 'a1', date: '2026-08-03', constructionTypeName: '組立', hours: 8,
    foremanName: '自社職長', workerCount: 3, autoCost: 54000, override: null, effectiveCost: 54000,
    foremanId: 'f1', memberCount: 3, workerIds: ['w1', 'w2', 'f1'], ...over,
});

describe('/api/own-crew-volume GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'manager' } }, error: null });
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({
            subcontractorRevenueRate: 60, subcontractorAssemblyRate: 60, subcontractorDemolitionRate: 40,
        });
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(new Map());
    });

    it('権限が無ければそのエラーを返し、集計は行わない', async () => {
        const err = NextResponse.json({ error: '権限がありません' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

        const res = await GET(req('year=2026&month=8'));
        expect(res.status).toBe(403);
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });

    it('その月に自社班の配置が無ければ空の合計を返す', async () => {
        const res = await GET(req('year=2026&month=8'));
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(json).toMatchObject({ year: 2026, month: 8, foremen: [], groups: [] });
        expect(json.totals.rowCount).toBe(0);
        expect(json.settings).toEqual({ revenueRate: 60, assemblyRate: 60, demolitionRate: 40, breakevenPerManday: 40000 });
    });

    it('協力業者の職長は除外し、自社職長の行と職長リストを返す', async () => {
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([
            { id: 'a1', projectMasterId: 'p1', assignedEmployeeId: 'f1', date: new Date('2026-08-03T00:00:00.000Z'), constructionType: 'ct1', memberCount: 3 },
            // 協力業者(大文字 PARTNER)の職長は自社班ではないので出さない
            { id: 'a2', projectMasterId: 'p1', assignedEmployeeId: 'pt1', date: new Date('2026-08-04T00:00:00.000Z'), constructionType: 'ct1', memberCount: 2 },
        ]);
        (prisma.user.findMany as jest.Mock)
            .mockResolvedValueOnce([
                { id: 'f1', displayName: '自社職長', role: 'FOREMAN2' },
                { id: 'pt1', displayName: '協力P', role: 'PARTNER' },
            ])
            .mockResolvedValueOnce([{ id: 'mgr1', displayName: '担当A' }])   // 案件担当者
            .mockResolvedValueOnce([{ id: 'w1', role: 'worker' }, { id: 'w2', role: 'PARTNER_MEMBER' }, { id: 'f1', role: 'foreman2' }]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(new Map([['p1', {
            breakdown: { laborCost: 54000, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 154000 },
            detail: { labor: [laborRow()], vehicle: [], subcontractor: [], manualItems: {}, purchaseInvoices: [] },
        }]]));
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', title: '現場A様 足場工事', name: '現場A', honorific: '様',
            customerName: '元請A', contractAmount: null, revenueOverride: null, createdBy: '["mgr1"]',
            subcontractorCosts: [],
        }]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            { subtotal: 1000000, items: null, projectMasterId: 'p1' },
        ]);

        const res = await GET(req('year=2026&month=8'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.foremen).toEqual([{ id: 'f1', displayName: '自社職長' }]);
        expect(json.groups).toHaveLength(1);
        expect(json.groups[0].foremanId).toBe('f1');
        expect(json.groups[0].rows).toHaveLength(1);

        const row = json.groups[0].rows[0];
        expect(row).toMatchObject({
            assignmentId: 'a1', projectTitle: '現場A様 足場工事', customerName: '元請A',
            managerName: '担当A', constructionTypeName: '組立', workerCount: 3, laborCost: 54000,
            salesBasis: 'invoice',
        });
        // V = 1,000,000 − (154,000 − 54,000) = 900,000、総人数3 → 全部この行
        expect(row.earnings).toBe(900_000);
        // 外注換算: 登録が無いので 1,000,000 × 60% × 60%(組立) = 360,000
        expect(row.outsourcingEquivalent).toBe(360_000);
        // w2 が協力業者ロールなので常用
        expect(row.flags).toContain('joyo');
        expect(json.totals).toMatchObject({ rowCount: 1, manDays: 3, laborCost: 54000, earnings: 900_000 });
        expect(json.totals.makeVsBuy).toBe(360_000 - 54_000);
    });

    it('foremanId を指定するとその職長の行だけに絞り、職長リストは全員返す', async () => {
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([
            { id: 'a1', projectMasterId: 'p1', assignedEmployeeId: 'f1', date: new Date('2026-08-03T00:00:00.000Z'), constructionType: 'ct1', memberCount: 3 },
            { id: 'a2', projectMasterId: 'p1', assignedEmployeeId: 'f2', date: new Date('2026-08-04T00:00:00.000Z'), constructionType: 'ct1', memberCount: 2 },
        ]);
        (prisma.user.findMany as jest.Mock)
            .mockResolvedValueOnce([
                { id: 'f1', displayName: 'あ職長', role: 'foreman1' },
                { id: 'f2', displayName: 'い職長', role: 'foreman2' },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(new Map([['p1', {
            breakdown: { laborCost: 90000, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 90000 },
            detail: {
                labor: [laborRow(), laborRow({ assignmentId: 'a2', date: '2026-08-04', foremanId: 'f2', workerCount: 2, effectiveCost: 36000, workerIds: [] })],
                vehicle: [], subcontractor: [], manualItems: {}, purchaseInvoices: [],
            },
        }]]));
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{
            id: 'p1', title: '現場A', name: null, honorific: null,
            customerName: null, contractAmount: null, revenueOverride: null, createdBy: null,
            subcontractorCosts: [],
        }]);

        const res = await GET(req('year=2026&month=8&foremanId=f2'));
        const json = await res.json();

        expect(json.foremen.map((f: { id: string }) => f.id)).toEqual(['f1', 'f2']);
        expect(json.groups).toHaveLength(1);
        expect(json.groups[0].foremanId).toBe('f2');
        expect(json.groups[0].rows.map((r: { assignmentId: string }) => r.assignmentId)).toEqual(['a2']);
        // 未請求なので unbilled、売上の手がかりも無いので稼ぎは出さない
        expect(json.groups[0].rows[0].flags).toContain('unbilled');
        expect(json.groups[0].rows[0].earnings).toBeNull();
    });

    it('月の範囲は JST 日境界で問い合わせ、過去データの配置は除外する', async () => {
        await GET(req('year=2026&month=8'));
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    date: {
                        gte: new Date(Date.UTC(2026, 7, 1, -9, 0, 0, 0)),
                        lt: new Date(Date.UTC(2026, 8, 1, -9, 0, 0, 0)),
                    },
                    isBackfilled: false,
                },
            }),
        );
    });
});
