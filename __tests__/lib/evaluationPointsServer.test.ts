/**
 * @jest-environment node
 *
 * lib/evaluationPointsServer.ts（評価ポイント: DB を読む側の共通部品）のテスト。
 *
 * いちばん大事なのは「班のメンバーの出し方が、出勤簿と食い違わない」こと。
 * @/lib/prisma は jest.setup.ts がモックに差し替えていて、where を見ずに決めた答えを返すだけなので、
 * 「返ってきた ID が同じ」を比べても、条件（日付の範囲・isBackfilled・isActive）の付け忘れは見つからない。
 * だから、既存の GET /api/attendance/members と getAttendanceMembers() が
 * prisma.projectAssignment.findMany・prisma.user.findMany に「渡した where」が同じことを比べる。
 */
import { NextRequest } from 'next/server';
import { GET as attendanceMembersGET } from '@/app/api/attendance/members/route';
import { prisma } from '@/lib/prisma';
import { actorOf, getAttendanceMembers, loadRatesByItemId } from '@/lib/evaluationPointsServer';

const assignmentFindMany = prisma.projectAssignment.findMany as unknown as jest.Mock;
const userFindMany = prisma.user.findMany as unknown as jest.Mock;
const rateFindMany = prisma.evaluationPointRate.findMany as unknown as jest.Mock;

const FOREMAN = 'f1';
const membersRequest = (date: string) => new NextRequest(`http://localhost/api/attendance/members?foremanId=${FOREMAN}&date=${date}`);

/** その呼び出しが、配置とユーザーの findMany に渡した where（ID の並びは問わない） */
const whereOf = async (run: () => Promise<unknown>) => {
    assignmentFindMany.mockClear();
    userFindMany.mockClear();
    await run();
    expect(assignmentFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    const userWhere = userFindMany.mock.calls[0][0].where as { id: { in: string[] } };
    return {
        assignment: assignmentFindMany.mock.calls[0][0].where as unknown,
        user: { ...userWhere, id: { in: [...userWhere.id.in].sort() } },
    };
};

beforeEach(() => {
    jest.clearAllMocks();
    // 既存の route は admin・manager・foreman1・foreman2 だけが呼べる。requireAuth の既定のモックは manager なので、そのまま使う

    // 配置4件: ID の重複・無効なユーザー（gone）・空の ID・空や null の confirmedWorkerIds
    assignmentFindMany.mockResolvedValue([
        { confirmedWorkerIds: '["w1","w2","w1"]', isDispatchConfirmed: true },
        { confirmedWorkerIds: '["w2","gone",""]', isDispatchConfirmed: false },
        { confirmedWorkerIds: null, isDispatchConfirmed: false },
        { confirmedWorkerIds: '', isDispatchConfirmed: false },
    ]);
    // モックは where を見ない。「DB が isActive: true で絞ったあとの結果」を、テストが決めて返す
    userFindMany.mockResolvedValue([
        { id: 'f1', displayName: '職長', role: 'FOREMAN2', dispatchSortOrder: 1 },
        { id: 'w1', displayName: '作業員1', role: 'WORKER', dispatchSortOrder: 2 },
        { id: 'w2', displayName: '作業員2', role: 'worker', dispatchSortOrder: null },
    ]);
});

describe('班のメンバーの出し方が、出勤簿と食い違わない', () => {
    it('既存の GET /api/attendance/members と getAttendanceMembers が、配置とユーザーを同じ where で引く', async () => {
        const fromRoute = await whereOf(async () => {
            const res = await attendanceMembersGET(membersRequest('2026-10-03'));
            expect(res.status).toBe(200);
        });
        const fromLib = await whereOf(() => getAttendanceMembers(FOREMAN, '2026-10-03'));
        expect(fromLib).toEqual(fromRoute);
    });

    it('月をまたぐ日・うるう日・年をまたぐ日でも同じ', async () => {
        for (const date of ['2026-11-01', '2026-12-31', '2028-02-29', '2027-01-01']) {
            const fromRoute = await whereOf(() => attendanceMembersGET(membersRequest(date)));
            const fromLib = await whereOf(() => getAttendanceMembers(FOREMAN, date));
            expect({ date, where: fromLib }).toEqual({ date, where: fromRoute });
        }
    });
});

describe('getAttendanceMembers', () => {
    it('日付の境界: 2026-10-03 を指定したら、配置は 2026-10-02T15:00Z 以上・2026-10-03T15:00Z 未満（日本時間のその日）', async () => {
        const { assignment, user } = await whereOf(() => getAttendanceMembers(FOREMAN, '2026-10-03'));
        expect(assignment).toEqual({
            assignedEmployeeId: FOREMAN,
            date: { gte: new Date('2026-10-02T15:00:00.000Z'), lt: new Date('2026-10-03T15:00:00.000Z') },
            isBackfilled: false,
        });
        // 職長本人を足す・重複は1つ・空の ID は入れない・isActive: true で絞る
        expect(user).toEqual({ id: { in: ['f1', 'gone', 'w1', 'w2'] }, isActive: true });
    });

    it('配置が1件も無い日は、職長本人だけを引く', async () => {
        assignmentFindMany.mockResolvedValue([]);
        const { user } = await whereOf(() => getAttendanceMembers(FOREMAN, '2026-10-03'));
        expect(user).toEqual({ id: { in: ['f1'] }, isActive: true });
    });

    it('返すのは DB から読んだ行（role は DB の値のまま＝大文字が混ざる）', async () => {
        const members = await getAttendanceMembers(FOREMAN, '2026-10-03');
        expect(members.map((m) => [m.id, m.role])).toEqual([['f1', 'FOREMAN2'], ['w1', 'WORKER'], ['w2', 'worker']]);
        expect(userFindMany.mock.calls[0][0].select).toEqual({ id: true, displayName: true, role: true });
    });

    it('形の違う・実在しない日付は例外にする（黙って空の配列を返さない）。DB も読まない', async () => {
        for (const bad of ['2026-02-30', '2026/10/31', '2026-1-1', '']) {
            await expect(getAttendanceMembers(FOREMAN, bad)).rejects.toThrow('日付の形が違います');
        }
        expect(assignmentFindMany).not.toHaveBeenCalled();
        expect(userFindMany).not.toHaveBeenCalled();
    });
});

describe('loadRatesByItemId', () => {
    it('項目ごとの点数の履歴を、resolveRateAt に渡せる形（日付は文字列）で返す', async () => {
        rateFindMany.mockResolvedValue([
            { id: 'rate1', itemId: 'wash', points: 2, effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), createdAt: new Date('2026-09-01T01:02:03.456Z') },
            { id: 'rate2', itemId: 'wash', points: 3, effectiveFrom: new Date('2026-12-31T00:00:00.000Z'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
        ]);
        const map = await loadRatesByItemId(['wash', 'help']);
        expect(rateFindMany).toHaveBeenCalledTimes(1);
        expect(rateFindMany.mock.calls[0][0].where).toEqual({ itemId: { in: ['wash', 'help'] } });
        expect(map.get('wash')).toEqual([
            // @db.Date の適用開始日（UTC 0時の印）は 'YYYY-MM-DD'、入れた日時は ISO 文字列
            { id: 'rate1', points: 2, effectiveFrom: '2026-09-01', createdAt: '2026-09-01T01:02:03.456Z' },
            { id: 'rate2', points: 3, effectiveFrom: '2026-12-31', createdAt: '2026-09-20T01:00:00.000Z' },
        ]);
        // 点数の行が無い項目は、空の配列で入る
        expect(map.get('help')).toEqual([]);
        expect([...map.keys()].sort()).toEqual(['help', 'wash']);
    });

    it('項目を1つも渡さなければ、DB を読まずに空の Map を返す', async () => {
        const map = await loadRatesByItemId([]);
        expect(map.size).toBe(0);
        expect(rateFindMany).not.toHaveBeenCalled();
    });
});

describe('actorOf', () => {
    it('id・role・名前（表示名）を返す。username は id にも名前にも使わない', () => {
        expect(actorOf({ user: { id: 'u1', role: 'foreman2', name: '職長A', username: 'login-u1' } }))
            .toEqual({ id: 'u1', role: 'foreman2', name: '職長A' });
    });

    it('表示名が無ければ username', () => {
        expect(actorOf({ user: { id: 'u1', username: 'taro', role: 'admin', name: null } }).name).toBe('taro');
        expect(actorOf({ user: { id: 'u1', username: 'taro', role: 'admin' } }).name).toBe('taro');
    });

    it('id・role が入っていない session は空文字（空文字のロールは、どの判定も通らない）', () => {
        expect(actorOf({ user: {} })).toEqual({ id: '', role: '', name: '' });
        expect(actorOf({ user: { id: null, role: undefined, name: null, username: null } })).toEqual({ id: '', role: '', name: '' });
    });
});
