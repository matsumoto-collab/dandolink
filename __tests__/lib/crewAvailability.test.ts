import { getCrewAvailability, getCrewAvailabilitySummaryRange, getFloating, STANDARD_HOURS } from '@/lib/crewAvailability';
import { prisma } from '@/lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
    projectAssignment: { findMany: jest.Mock };
    systemSettings: { findUnique: jest.Mock };
    vacationRecord: { findUnique: jest.Mock; findMany: jest.Mock };
    memberAdjustment: { findUnique: jest.Mock; findMany: jest.Mock };
    memberCountHistory: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
};

const pm = (name: string, createdBy: string[] | null = null) => ({
    name,
    title: `${name} 工事`,
    honorific: '様邸',
    createdBy: createdBy ? JSON.stringify(createdBy) : null,
});

describe('getCrewAvailability', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.systemSettings.findUnique.mockResolvedValue({
            displayedForemanIds: JSON.stringify(['f1', 'f2']),
            totalMembers: 20,
        });
        mockPrisma.vacationRecord.findUnique.mockResolvedValue(null);
        mockPrisma.memberAdjustment.findUnique.mockResolvedValue(null);
        mockPrisma.memberCountHistory.findMany.mockResolvedValue([]);
        // loadForemen 用と owners 解決用の user.findMany を順不同で捌く
        mockPrisma.user.findMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
            const ids: string[] = args?.where?.id?.in ?? [];
            const all: Record<string, string> = { f1: '山田', f2: '田中', u1: '佐藤', u2: '鈴木' };
            return ids.filter((id) => all[id]).map((id) => ({ id, displayName: all[id] }));
        });
    });

    it('6時間の予定がある班は空き2時間、予定なしの班は終日空き', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            {
                assignedEmployeeId: 'f1',
                estimatedHours: 6,
                memberCount: 3,
                dateStatus: 'confirmed',
                confirmDueDate: null,
                remarks: null,
                projectMaster: pm('△△'),
            },
        ]);

        const result = await getCrewAvailability('2026-08-05');

        expect(result.date).toBe('2026-08-05');
        const yamada = result.teams.find((t) => t.team === '山田')!;
        expect(yamada.usedHours).toBe(6);
        expect(yamada.freeHours).toBe(2);
        expect(yamada.usedMembers).toBe(3);
        expect(yamada.negotiableMembers).toBe(0);

        const tanaka = result.teams.find((t) => t.team === '田中')!;
        expect(tanaka.freeHours).toBe(STANDARD_HOURS);
        expect(tanaka.jobs).toHaveLength(0);
    });

    it('仮予定は negotiableMembers に人数が積まれ、確認予定日と担当者名が付く', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            {
                assignedEmployeeId: 'f1',
                estimatedHours: 8,
                memberCount: 3,
                dateStatus: 'tentative',
                // JST 8/1 0時 = UTC 7/31 15:00
                confirmDueDate: new Date('2026-07-31T15:00:00.000Z'),
                remarks: null,
                projectMaster: pm('△△', ['u1', 'u2']),
            },
        ]);

        const result = await getCrewAvailability('2026-08-05');
        const yamada = result.teams.find((t) => t.team === '山田')!;
        expect(yamada.negotiableMembers).toBe(3);
        expect(yamada.jobs[0].dateStatus).toBe('tentative');
        expect(yamada.jobs[0].confirmDueDate).toBe('2026-08-01');
        expect(yamada.jobs[0].owners).toEqual(['佐藤', '鈴木']);
    });

    it('浮き（unassigned）は floating に入り、班の集計には入らない', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            {
                assignedEmployeeId: 'unassigned',
                estimatedHours: 8,
                memberCount: 4,
                dateStatus: 'tentative',
                confirmDueDate: null,
                remarks: '急ぎ',
                projectMaster: pm('◯◯', ['u1']),
            },
        ]);

        const result = await getCrewAvailability('2026-08-05');
        expect(result.floating).toHaveLength(1);
        expect(result.floating[0]).toMatchObject({
            site: '◯◯様邸',
            memberCount: 4,
            dateStatus: 'tentative',
            note: '急ぎ',
            owners: ['佐藤'],
        });
        // 班側には積まれない
        expect(result.teams.every((t) => t.usedMembers === 0)).toBe(true);
    });

    it('summary: 残り人数 = 総メンバー数 − 使用人数（班ごと最大＋浮き）− 休暇', async () => {
        mockPrisma.memberCountHistory.findMany.mockResolvedValue([
            { startDate: new Date('2026-01-01T00:00:00.000Z'), count: 18 },
        ]);
        mockPrisma.memberAdjustment.findUnique.mockResolvedValue({ adjustment: 2 });
        mockPrisma.vacationRecord.findUnique.mockResolvedValue({ employeeIds: JSON.stringify(['x1', 'x2', 'x3']) });
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            // 同じ班の掛け持ちは最大値（3人と2人 → 3人）
            { assignedEmployeeId: 'f1', estimatedHours: 4, memberCount: 3, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('A') },
            { assignedEmployeeId: 'f1', estimatedHours: 4, memberCount: 2, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('B') },
            // 浮きは単純加算
            { assignedEmployeeId: 'unassigned', estimatedHours: 8, memberCount: 4, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('C') },
        ]);

        const result = await getCrewAvailability('2026-08-05');
        // total = 18 + 調整2 = 20 / used = max(3,2) + 浮き4 = 7 / 休暇3 → 残り10
        expect(result.summary).toMatchObject({
            totalMembers: 20,
            usedMembers: 7,
            vacationMembers: 3,
            remainingMembers: 10,
        });
        // 班別の usedMembers も最大値規約
        expect(result.teams.find((t) => t.team === '山田')!.usedMembers).toBe(3);
    });

    it('summary: 人数0の仮予定でも tentativeJobCount に数える（negotiableMembers=0 と区別する）', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            // 人数0の仮予定 → negotiableMembers は0のままだが件数は1
            { assignedEmployeeId: 'f1', estimatedHours: 8, memberCount: 0, dateStatus: 'tentative', confirmDueDate: null, remarks: null, projectMaster: pm('A') },
            { assignedEmployeeId: 'f2', estimatedHours: 8, memberCount: 2, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('B') },
        ]);

        const result = await getCrewAvailability('2026-08-05');
        expect(result.summary.tentativeJobCount).toBe(1);
        expect(result.summary.negotiableMembers).toBe(0);
    });

    it('JST境界: 日付範囲は「JSTのその日0時」の実時刻で問い合わせる（実時刻の配置を取りこぼさない）', async () => {
        // date 列は正規化されておらず時分秒入りの実時刻が入る。
        // where を実際に適用して、範囲がJST日と一致することを検証する。
        const rows = [
            // JST 7/23 0:30 → 含まれるべき
            { date: new Date('2026-07-22T15:30:00.000Z'), assignedEmployeeId: 'f1', estimatedHours: 8, memberCount: 3, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('境界内') },
            // JST 7/24 1:00 → 含まれてはいけない
            { date: new Date('2026-07-23T16:00:00.000Z'), assignedEmployeeId: 'f2', estimatedHours: 8, memberCount: 5, dateStatus: 'confirmed', confirmDueDate: null, remarks: null, projectMaster: pm('境界外') },
        ];
        mockPrisma.projectAssignment.findMany.mockImplementation(
            async (args: { where?: { date?: { gte?: Date; lt?: Date } } }) => {
                const { gte, lt } = args?.where?.date ?? {};
                return rows.filter((r) => (!gte || r.date >= gte) && (!lt || r.date < lt));
            }
        );

        const result = await getCrewAvailability('2026-07-23');

        expect(result.date).toBe('2026-07-23');
        expect(result.teams.find((t) => t.team === '山田')!.jobs.map((j) => j.site)).toEqual(['境界内様邸']);
        expect(result.teams.find((t) => t.team === '田中')!.jobs).toHaveLength(0);
        expect(result.summary.usedMembers).toBe(3);
    });

    it('予定合計が8時間を超えたら空きは0（マイナスにしない）、休みの班は off', async () => {
        mockPrisma.vacationRecord.findUnique.mockResolvedValue({
            employeeIds: JSON.stringify(['f2']),
        });
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            {
                assignedEmployeeId: 'f1',
                estimatedHours: 5,
                memberCount: 2,
                dateStatus: 'confirmed',
                confirmDueDate: null,
                remarks: null,
                projectMaster: pm('A'),
            },
            {
                assignedEmployeeId: 'f1',
                estimatedHours: 4,
                memberCount: 2,
                dateStatus: 'confirmed',
                confirmDueDate: null,
                remarks: null,
                projectMaster: pm('B'),
            },
        ]);

        const result = await getCrewAvailability('2026-08-05');
        const yamada = result.teams.find((t) => t.team === '山田')!;
        expect(yamada.usedHours).toBe(9);
        expect(yamada.freeHours).toBe(0);

        const tanaka = result.teams.find((t) => t.team === '田中')!;
        expect(tanaka.status).toBe('off');
    });
});

describe('getCrewAvailabilitySummaryRange', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.systemSettings.findUnique.mockResolvedValue({ totalMembers: 20 });
        mockPrisma.memberCountHistory.findMany.mockResolvedValue([]);
        mockPrisma.vacationRecord.findMany.mockResolvedValue([]);
        mockPrisma.memberAdjustment.findMany.mockResolvedValue([]);
    });

    it('日ごとのサマリを日数分返す（配置がない日も残り人数=総数）', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            // JST 8/2 0時 = UTC 8/1 15:00
            { date: new Date('2026-08-01T15:00:00.000Z'), assignedEmployeeId: 'f1', memberCount: 5, dateStatus: 'confirmed' },
        ]);

        const result = await getCrewAvailabilitySummaryRange('2026-08-01', '2026-08-03');
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ date: '2026-08-01', remainingMembers: 20 });
        expect(result[1]).toMatchObject({ date: '2026-08-02', usedMembers: 5, remainingMembers: 15 });
        expect(result[2]).toMatchObject({ date: '2026-08-03', remainingMembers: 20 });
    });

    it('期間は最大14日にクランプされる', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
        const result = await getCrewAvailabilitySummaryRange('2026-08-01', '2026-09-30');
        expect(result).toHaveLength(14);
    });
});

describe('getFloating', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', displayName: '佐藤' }]);
    });

    it('期間内の浮きを日付キー（JST）付きで返す', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            {
                // JST 8/12 0時 = UTC 8/11 15:00
                date: new Date('2026-08-11T15:00:00.000Z'),
                memberCount: 3,
                dateStatus: 'tentative',
                remarks: null,
                projectMaster: pm('△△', ['u1']),
            },
        ]);

        const result = await getFloating('2026-08-01', '2026-08-31');
        expect(result).toHaveLength(1);
        expect(result[0].date).toBe('2026-08-12');
        expect(result[0].dateStatus).toBe('tentative');
        expect(result[0].owners).toEqual(['佐藤']);

        // where 条件が 'unassigned' に限定されていること（正門の集計対象）
        const args = mockPrisma.projectAssignment.findMany.mock.calls[0][0];
        expect(args.where.assignedEmployeeId).toBe('unassigned');
    });
});
