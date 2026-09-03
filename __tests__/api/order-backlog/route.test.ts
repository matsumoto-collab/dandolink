/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET as getCandidates } from '@/app/api/order-backlog/candidates/route';
import { GET as listReports, POST as createReport } from '@/app/api/order-backlog/reports/route';
import { GET as getReport, DELETE as deleteReport } from '@/app/api/order-backlog/reports/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

/**
 * 受注明細書 API は admin 限定（kei 決定）。
 * 本番の role には大文字が混じるので 'ADMIN' でも通ること・manager は 403 になることを見る。
 */
describe('受注明細書 API の権限', () => {
    const asAdmin = () =>
        (requireAuth as jest.Mock).mockResolvedValue({
            // 本番に大文字ロールが混在するので、大文字でも admin と判定できること
            session: { user: { id: 'user-1', role: 'ADMIN', name: '管理者', isActive: true } },
            error: null,
        });
    const asManager = () =>
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'user-2', role: 'manager', isActive: true } },
            error: null,
        });

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.orderBacklogReport.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.orderBacklogReport.findUnique as jest.Mock).mockResolvedValue(null);
    });

    it('manager は候補取得で 403', async () => {
        asManager();
        const res = await getCandidates(
            new NextRequest('http://localhost:3000/api/order-backlog/candidates?asOf=2026-09-01'),
        );
        expect(res.status).toBe(403);
        expect(prisma.projectMaster.findMany).not.toHaveBeenCalled();
    });

    it('manager は一覧取得で 403', async () => {
        asManager();
        const res = await listReports();
        expect(res.status).toBe(403);
    });

    it('manager は作成で 403', async () => {
        asManager();
        const req = new NextRequest('http://localhost:3000/api/order-backlog/reports', {
            method: 'POST',
            body: JSON.stringify({ asOfDate: '2026-09-01', lines: [] }),
        });
        const res = await createReport(req);
        expect(res.status).toBe(403);
        expect(prisma.orderBacklogReport.create).not.toHaveBeenCalled();
    });

    it('manager は個別取得・削除で 403', async () => {
        asManager();
        const params = { params: { id: 'r-1' } };
        expect(
            (await getReport(new NextRequest('http://localhost:3000/api/order-backlog/reports/r-1'), params)).status,
        ).toBe(403);
        expect(
            (
                await deleteReport(
                    new NextRequest('http://localhost:3000/api/order-backlog/reports/r-1', { method: 'DELETE' }),
                    params,
                )
            ).status,
        ).toBe(403);
        expect(prisma.orderBacklogReport.delete).not.toHaveBeenCalled();
    });

    it('admin（大文字 ADMIN）は候補取得できる', async () => {
        asAdmin();
        const res = await getCandidates(
            new NextRequest('http://localhost:3000/api/order-backlog/candidates?asOf=2026-09-01'),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ lines: [], warnings: [] });
    });

    it('admin でも asOf が不正なら 400（DB は触らない）', async () => {
        asAdmin();
        const res = await getCandidates(
            new NextRequest('http://localhost:3000/api/order-backlog/candidates?asOf=2026/09/01'),
        );
        expect(res.status).toBe(400);
        expect(prisma.projectMaster.findMany).not.toHaveBeenCalled();
    });

    it('admin の作成は明細ごと保存し 201 を返す', async () => {
        asAdmin();
        (prisma.orderBacklogReport.create as jest.Mock).mockResolvedValue({
            id: 'r-1',
            asOfDate: new Date('2026-09-01T00:00:00.000Z'),
            title: 'テスト',
            applicantName: null,
            individualThreshold: 1000000,
            unreceivedMode: 'remaining',
            taxMode: 'inclusive',
            notes: null,
            createdById: 'user-1',
            createdByName: '管理者',
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            updatedAt: new Date('2026-09-01T00:00:00.000Z'),
            lines: [
                {
                    id: 'l-1',
                    reportId: 'r-1',
                    sortOrder: 0,
                    projectMasterId: 'pm-1',
                    customerName: 'A社',
                    projectName: 'A現場',
                    workKind: 'temp',
                    siteKind: 'other',
                    contractAmount: 1100000,
                    startYm: '2026-08',
                    endYm: '2026-10',
                    progressRate: 50,
                    receivedAmount: 0,
                    schedule: { '2026-09': 660000, '2026-11': 440000 },
                    excluded: false,
                    isManual: false,
                    note: null,
                },
            ],
        });

        const req = new NextRequest('http://localhost:3000/api/order-backlog/reports', {
            method: 'POST',
            body: JSON.stringify({
                asOfDate: '2026-09-01',
                title: 'テスト',
                lines: [
                    {
                        projectMasterId: 'pm-1',
                        customerName: 'A社',
                        projectName: 'A現場',
                        workKind: 'temp',
                        siteKind: 'other',
                        contractAmount: 1100000,
                        startYm: '2026-08',
                        endYm: '2026-10',
                        progressRate: 50,
                        receivedAmount: 0,
                        schedule: { '2026-09': 660000, '2026-11': 440000 },
                        excluded: false,
                        isManual: false,
                        sortOrder: 0,
                    },
                ],
            }),
        });
        const res = await createReport(req);
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.report.id).toBe('r-1');
        expect(body.report.asOfDate).toBe('2026-09-01');
        expect(body.lines).toHaveLength(1);
        expect(body.lines[0].schedule).toEqual({ '2026-09': 660000, '2026-11': 440000 });
    });

    it('admin でも出来高が範囲外なら 400', async () => {
        asAdmin();
        const req = new NextRequest('http://localhost:3000/api/order-backlog/reports', {
            method: 'POST',
            body: JSON.stringify({
                asOfDate: '2026-09-01',
                lines: [{ customerName: 'A社', projectName: 'A現場', progressRate: 120 }],
            }),
        });
        const res = await createReport(req);
        expect(res.status).toBe(400);
        expect(prisma.orderBacklogReport.create).not.toHaveBeenCalled();
    });

    it('存在しない ID は 404', async () => {
        asAdmin();
        const res = await getReport(new NextRequest('http://localhost:3000/api/order-backlog/reports/none'), {
            params: { id: 'none' },
        });
        expect(res.status).toBe(404);
    });
});
