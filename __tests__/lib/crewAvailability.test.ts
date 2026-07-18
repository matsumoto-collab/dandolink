import { getCrewAvailability, getFloating, STANDARD_HOURS } from '@/lib/crewAvailability';
import { prisma } from '@/lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
    projectAssignment: { findMany: jest.Mock };
    systemSettings: { findUnique: jest.Mock };
    vacationRecord: { findUnique: jest.Mock };
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
        });
        mockPrisma.vacationRecord.findUnique.mockResolvedValue(null);
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
