/**
 * @jest-environment node
 */
import { relocateAssignmentWorkItems } from '@/lib/relocateWorkItems';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        dailyReportWorkItem: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
        dailyReport: { upsert: jest.fn() },
    },
}));

describe('relocateAssignmentWorkItems', () => {
    beforeEach(() => jest.clearAllMocks());

    it('同じJST日への移動なら何もしない', async () => {
        // どちらも JST 5/15
        await relocateAssignmentWorkItems('a1', new Date('2026-05-14T23:32:00Z'), new Date('2026-05-14T20:00:00Z'), 'u1');
        expect(prisma.dailyReportWorkItem.findMany).not.toHaveBeenCalled();
    });

    it('旧日付の明細を新日付の日報へ付け替える（重複なし）', async () => {
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { id: 'wi1', dailyReport: { foremanId: 'f1', date: new Date('2026-05-14T00:00:00Z') } },
        ]);
        (prisma.dailyReport.upsert as jest.Mock).mockResolvedValue({ id: 'dr-new' });
        (prisma.dailyReportWorkItem.findFirst as jest.Mock).mockResolvedValue(null);

        await relocateAssignmentWorkItems('a1', new Date('2026-05-14T00:00:00Z'), new Date('2026-05-15T00:00:00Z'), 'u1');

        expect(prisma.dailyReport.upsert).toHaveBeenCalled();
        expect(prisma.dailyReportWorkItem.update).toHaveBeenCalledWith({ where: { id: 'wi1' }, data: { dailyReportId: 'dr-new' } });
        expect(prisma.dailyReportWorkItem.delete).not.toHaveBeenCalled();
    });

    it('移送先に既に同じ配置の明細があれば旧明細を削除（重複回避）', async () => {
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { id: 'wi-orphan', dailyReport: { foremanId: 'f1', date: new Date('2026-05-14T00:00:00Z') } },
        ]);
        (prisma.dailyReport.upsert as jest.Mock).mockResolvedValue({ id: 'dr-new' });
        (prisma.dailyReportWorkItem.findFirst as jest.Mock).mockResolvedValue({ id: 'wi-real' });

        await relocateAssignmentWorkItems('a1', new Date('2026-05-14T00:00:00Z'), new Date('2026-05-15T00:00:00Z'), 'u1');

        expect(prisma.dailyReportWorkItem.delete).toHaveBeenCalledWith({ where: { id: 'wi-orphan' } });
        expect(prisma.dailyReportWorkItem.update).not.toHaveBeenCalled();
    });

    it('既に新日付にある明細は触らない', async () => {
        (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([
            { id: 'wi1', dailyReport: { foremanId: 'f1', date: new Date('2026-05-15T00:00:00Z') } },
        ]);
        await relocateAssignmentWorkItems('a1', new Date('2026-05-14T00:00:00Z'), new Date('2026-05-15T00:00:00Z'), 'u1');
        expect(prisma.dailyReport.upsert).not.toHaveBeenCalled();
        expect(prisma.dailyReportWorkItem.update).not.toHaveBeenCalled();
        expect(prisma.dailyReportWorkItem.delete).not.toHaveBeenCalled();
    });
});
