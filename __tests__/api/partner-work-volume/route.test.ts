/**
 * @jest-environment node
 */
import { GET } from '@/app/api/partner-work-volume/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findMany: jest.fn() },
        projectAssignment: { findMany: jest.fn() },
        constructionType: { findMany: jest.fn() },
        partnerWorkVolume: { findMany: jest.fn() },
        partnerWorkVolumeMonth: { findUnique: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    // 実装どおりに動く軽量版（confirmedWorkerIds / createdBy の JSON 解釈に使う）
    parseJsonField: (v: unknown, fallback: unknown) => {
        if (typeof v !== 'string') return fallback;
        try { return JSON.parse(v); } catch { return fallback; }
    },
}));

const PARTNER_ID = 'partner-1';
const CT_ASSEMBLY = 'ct-assembly';

// 協力会社自身が職長の配置（ownTeam）を1件作るヘルパー
const ownAssignment = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    date: new Date('2026-06-10T00:00:00Z'),
    assignedEmployeeId: PARTNER_ID,
    confirmedWorkerIds: '[]',
    constructionType: CT_ASSEMBLY,
    isDispatchConfirmed: true,
    subcontractorCostOverride: null,
    projectMaster: {
        id: 'pm1',
        title: '案件1',
        name: null,
        honorific: null,
        customerShortName: null,
        customerName: '顧客A',
        createdBy: '[]',
        managerIds: [],
        subcontractorCosts: [{ constructionTypeId: CT_ASSEMBLY, amount: 36000, transportCost: 0 }],
    },
    ...over,
});

const setAssignments = (rows: ReturnType<typeof ownAssignment>[]) =>
    (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue(rows);

const req = () =>
    new NextRequest(`http://localhost:3000/api/partner-work-volume?companyId=${PARTNER_ID}&year=2026&month=6`);

describe('/api/partner-work-volume GET — 原価と一致する重複排除', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'admin-1', role: 'admin' } }, error: null });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: PARTNER_ID, role: 'partner', displayName: '協力P', partnerTaxMode: 'exclusive',
        });
        // members / managers / foremen いずれも user.findMany。テストでは全て空。
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([{ id: CT_ASSEMBLY, name: '組立' }]);
        (prisma.partnerWorkVolume.findMany as jest.Mock).mockResolvedValue([]);
        // 公開状態の参照先（PartnerWorkVolumeMonth）。admin ロールでは公開フラグは表示をゲートしないため null で十分。
        (prisma.partnerWorkVolumeMonth.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it('同一案件×同一種別が複数手配でも、作業費の合計は単価1回分（代表配置のみ計上）', async () => {
        setAssignments([
            ownAssignment({ id: 'a1', date: new Date('2026-06-10T00:00:00Z') }),
            ownAssignment({ id: 'a2', date: new Date('2026-06-11T00:00:00Z') }),
        ]);

        const json = await (await GET(req())).json();
        const workRows = json.rows.filter((r: { rowType: string; projectMasterId: string }) => r.rowType === 'work' && r.projectMasterId === 'pm1');

        // 行は日々の worklog として2件残るが、金額は代表配置(1件)のみ＝単価1回分
        expect(workRows).toHaveLength(2);
        expect(workRows.reduce((s: number, r: { amount: number }) => s + r.amount, 0)).toBe(36000);
        expect(workRows.filter((r: { amount: number }) => r.amount === 36000)).toHaveLength(1);
        expect(workRows.filter((r: { amount: number }) => r.amount === 0)).toHaveLength(1);
    });

    it('運搬費も種別ごと1回（代表配置のみ）', async () => {
        const withTransport = (id: string, date: string) => ownAssignment({
            id, date: new Date(date),
            projectMaster: { ...ownAssignment().projectMaster, subcontractorCosts: [{ constructionTypeId: CT_ASSEMBLY, amount: 36000, transportCost: 5000 }] },
        });
        setAssignments([withTransport('a1', '2026-06-10T00:00:00Z'), withTransport('a2', '2026-06-11T00:00:00Z')]);

        const json = await (await GET(req())).json();
        const transportRows = json.rows.filter((r: { rowType: string }) => r.rowType === 'transport');

        expect(transportRows).toHaveLength(1);
        expect(transportRows[0].amount).toBe(5000);
    });

    it('手配未確定の配置は作業費の自動行を出さない（原価0と一致）', async () => {
        setAssignments([ownAssignment({ id: 'a1', isDispatchConfirmed: false })]);

        const json = await (await GET(req())).json();
        const workRows = json.rows.filter((r: { rowType: string }) => r.rowType === 'work');

        expect(workRows).toHaveLength(0);
    });

    it('上書きは外注費の総額（運搬費は別出ししない）', async () => {
        setAssignments([ownAssignment({
            id: 'a1',
            subcontractorCostOverride: 50000,
            projectMaster: { ...ownAssignment().projectMaster, subcontractorCosts: [{ constructionTypeId: CT_ASSEMBLY, amount: 36000, transportCost: 5000 }] },
        })]);

        const json = await (await GET(req())).json();
        const workRows = json.rows.filter((r: { rowType: string }) => r.rowType === 'work');
        const transportRows = json.rows.filter((r: { rowType: string }) => r.rowType === 'transport');

        expect(workRows).toHaveLength(1);
        expect(workRows[0].amount).toBe(50000); // 上書き＝総額
        expect(transportRows).toHaveLength(0);  // 運搬費は別出ししない
    });
});
