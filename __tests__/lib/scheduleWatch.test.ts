import { runScheduleWatch, SCHEDULE_WATCH_TYPE } from '@/lib/scheduleWatch';
import { prisma } from '@/lib/prisma';
import { notifyUsers } from '@/lib/notifications';
import { toJstDateOnly } from '@/lib/dateUtils';

jest.mock('@/lib/notifications', () => ({
    notifyUsers: jest.fn().mockResolvedValue({ notificationIds: [], push: { sent: 0, removed: 0, failed: 0 } }),
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
    projectAssignment: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
};
const mockNotify = notifyUsers as jest.Mock;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const today = toJstDateOnly(new Date());
const inDays = (n: number) => new Date(today.getTime() + n * MS_PER_DAY);

const pm = (name: string, createdBy: string[]) => ({
    name,
    title: `${name} 工事`,
    createdBy: JSON.stringify(createdBy),
});

/** findMany は 1回目=確認漏れの仮予定 / 2回目=浮き の順で呼ばれる */
function mockQueries(overdueTentative: unknown[], floating: unknown[]) {
    mockPrisma.projectAssignment.findMany
        .mockResolvedValueOnce(overdueTentative)
        .mockResolvedValueOnce(floating);
}

describe('runScheduleWatch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // user.findMany: 1回目=管理者 / 2回目=担当者のisActiveフィルタ
        mockPrisma.user.findMany.mockImplementation(async (args: { where?: { role?: unknown; id?: { in?: string[] } } }) => {
            if (args?.where?.role) return [{ id: 'mgr1' }];
            const ids: string[] = args?.where?.id?.in ?? [];
            return ids.map((id) => ({ id }));
        });
    });

    it('検知0件なら通知を送らない', async () => {
        mockQueries([], []);
        const result = await runScheduleWatch();
        expect(result).toEqual({ detected: 0, notifiedUsers: 0 });
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('確認漏れの仮予定は案件担当者へ、1ユーザー1通のダイジェストで送る', async () => {
        mockQueries(
            [
                {
                    id: 'a1',
                    date: inDays(10),
                    confirmDueDate: inDays(-1),
                    assignedEmployeeId: 'f1',
                    projectMaster: pm('△△', ['u1']),
                },
            ],
            []
        );

        const result = await runScheduleWatch();
        expect(result.detected).toBe(1);
        expect(result.notifiedUsers).toBe(1);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        const call = mockNotify.mock.calls[0][0];
        expect(call.userIds).toEqual(['u1']);
        expect(call.type).toBe(SCHEDULE_WATCH_TYPE);
        expect(call.title).toContain('確認漏れ1件');
        expect(call.body).toContain('△△');
        expect(call.body).toContain('確認予定日');
    });

    it('浮きは案件担当者に加えて管理者にも届く', async () => {
        mockQueries(
            [],
            [
                {
                    id: 'a2',
                    date: inDays(3),
                    memberCount: 3,
                    dateStatus: 'confirmed',
                    confirmDueDate: null,
                    projectMaster: pm('◯◯', ['u1']),
                },
            ]
        );

        const result = await runScheduleWatch();
        expect(result.notifiedUsers).toBe(2); // u1 + mgr1
        const userIds = mockNotify.mock.calls.map((c) => c[0].userIds[0]).sort();
        expect(userIds).toEqual(['mgr1', 'u1']);
        const body = mockNotify.mock.calls[0][0].body as string;
        expect(body).toContain('浮き');
        expect(body).toContain('3人');
        expect(body).toContain('あと3日');
    });

    it('仮の浮き（確認予定日も超過）は1項目に統合し、浮き主文＋従文＋(日付も仮)', async () => {
        mockQueries(
            [],
            [
                {
                    id: 'a3',
                    date: inDays(2),
                    memberCount: 3,
                    dateStatus: 'tentative',
                    confirmDueDate: inDays(-2),
                    projectMaster: pm('△△', ['u1']),
                },
            ]
        );

        const result = await runScheduleWatch();
        expect(result.detected).toBe(1); // 2条件ヒットでも1項目
        const call = mockNotify.mock.calls.find((c) => c[0].userIds[0] === 'u1')![0];
        const body = call.body as string;
        expect(body).toContain('日付も仮');
        expect(body).toContain('未解消');
        expect(body).toContain('先方への日程確認も予定日を過ぎています');
        // 1通に統合されている（u1宛は1回だけ）
        expect(mockNotify.mock.calls.filter((c) => c[0].userIds[0] === 'u1')).toHaveLength(1);
    });

    it('当日を過ぎた浮きも通知に残る（自動処理しない）', async () => {
        mockQueries(
            [],
            [
                {
                    id: 'a4',
                    date: inDays(-2),
                    memberCount: 2,
                    dateStatus: 'confirmed',
                    confirmDueDate: null,
                    projectMaster: pm('◯◯', ['u1']),
                },
            ]
        );

        await runScheduleWatch();
        const body = mockNotify.mock.calls[0][0].body as string;
        expect(body).toContain('2日超過');
    });
});
