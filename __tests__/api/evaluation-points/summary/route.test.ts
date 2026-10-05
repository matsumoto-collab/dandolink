/**
 * @jest-environment node
 *
 * 評価ポイントの集計と CSV の API のテスト（docs/指示書_評価ポイント.md の 6-3・8-1）。
 *   GET /api/evaluation-points/summary
 *   GET /api/evaluation-points/export?type=detail|summary
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * user.findMany は「在籍している人＋記録のある人」を、このテストが決めて返す。
 */
import { NextRequest } from 'next/server';
import { GET as getSummaryRoute } from '@/app/api/evaluation-points/summary/route';
import { GET as getExportRoute } from '@/app/api/evaluation-points/export/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };

interface SummaryBody {
    error?: string; details?: string;
    startDate?: string; endDate?: string;
    items?: { id: string; name: string; inputBy: string; isActive: boolean }[];
    people?: { userId: string; displayName: string; role: string; byItem: Record<string, { count: number; points: number }>; totalCount: number; totalPoints: number; pendingCount: number; pendingPoints: number }[];
    totals?: { byItem: Record<string, { count: number; points: number }>; totalCount: number; totalPoints: number; pendingCount: number };
    eligiblePeople?: { userId: string; displayName: string; role: string }[];
}

const getSummary = async (query = 'startDate=2026-09-01&endDate=2026-09-30') => {
    const res = await getSummaryRoute(new NextRequest(`http://localhost/api/evaluation-points/summary?${query}`));
    return { status: res.status, body: (await res.json()) as SummaryBody, res };
};
/** CSV の本文: 先頭が BOM（EF BB BF）であることを確かめてから、CRLF で行に分ける */
const csvLines = async (res: Response) => {
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString('utf8');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/); // 改行は全部 CRLF
    return text.split('\r\n');
};
const getExport = (query: string) => getExportRoute(new NextRequest(`http://localhost/api/evaluation-points/export?${query}`));

/** 9月の記録: 作業員1 に洗車2回（確定）・ヘルプ1回（確認待ち）、退職した作業員2 に旧項目1回 */
const RECORDS = [
    { userId: 'worker1', itemId: 'wash', points: 2, status: 'confirmed' },
    { userId: 'worker1', itemId: 'wash', points: 3, status: 'confirmed' },
    { userId: 'worker1', itemId: 'help', points: 5, status: 'pending' },
    { userId: 'retired', itemId: 'old', points: 1, status: 'confirmed' },
];

const ITEM_ROWS = [
    { id: 'wash', name: '洗車', inputBy: 'foreman', isActive: true },
    { id: 'help', name: 'ヘルプ', inputBy: 'foreman', isActive: true },
    { id: 'old', name: '片付け（旧）', inputBy: 'foreman', isActive: false },
    { id: 'unused', name: '使わない項目', inputBy: 'admin', isActive: false },
];

const USERS = [
    { id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true, dispatchSortOrder: 2 },
    { id: 'foreman1', displayName: '職長1', role: 'FOREMAN1', isActive: true, dispatchSortOrder: 1 },
    { id: 'worker3', displayName: 'あ作業員', role: 'worker', isActive: true, dispatchSortOrder: null },
    { id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true, dispatchSortOrder: null },
    { id: 'manager1', displayName: 'マネージャー1', role: 'Manager', isActive: true, dispatchSortOrder: 5 },
    { id: 'partner1', displayName: '協力会社のメンバー', role: 'PARTNER_MEMBER', isActive: true, dispatchSortOrder: 0 },
    { id: 'retired', displayName: '作業員2（退職）', role: 'WORKER', isActive: false, dispatchSortOrder: 3 },
];

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    mock(prisma.evaluationPointRecord.findMany).mockResolvedValue(RECORDS);
    mock(prisma.evaluationPointItem.findMany).mockResolvedValue(ITEM_ROWS);
    mock(prisma.user.findMany).mockResolvedValue(USERS);
    // 「ありがとう」: 1件も無い・設定の行が無い（＝使わない）
    mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue(null);
});

describe('GET /summary', () => {
    it('職長・作業員は 403。何も読まない', async () => {
        for (const role of ['foreman1', 'foreman2', 'worker', 'partner']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getSummary();
            expect([role, r.status, r.body.error]).toEqual([role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
    });

    it('マネージャーは開ける', async () => {
        loginAs({ id: 'manager1', role: 'manager', name: 'マネージャー1' });
        expect((await getSummary()).status).toBe(200);
    });

    it('期間は必須・日付の形・開始 > 終了 は 400', async () => {
        const none = await getSummary('');
        expect([none.status, none.body.details]).toEqual([400, '入力が不正です']);
        const bad = await getSummary('startDate=2026-09-31&endDate=2026-10-01');
        expect([bad.status, bad.body.details]).toEqual([400, '日付が不正です']);
        const rev = await getSummary('startDate=2026-10-01&endDate=2026-09-01');
        expect([rev.status, rev.body.details]).toEqual([400, '日付が不正です']);
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
    });

    it('期間の範囲は gte: 開始日・lt: 終了日の翌日。人は where にロールを書かずに引く', async () => {
        await getSummary();
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
        });
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({
            OR: [{ isActive: true }, { id: { in: ['worker1', 'retired'] } }],
        });
    });

    it('確認待ちは合計に入らない（件数と点数は別に出す）', async () => {
        const { body } = await getSummary();
        const w1 = body.people!.find((p) => p.userId === 'worker1')!;
        expect(w1).toEqual({
            userId: 'worker1', displayName: '作業員1', role: 'worker',
            byItem: { wash: { count: 2, points: 5 } },
            totalCount: 2, totalPoints: 5, pendingCount: 1, pendingPoints: 5,
        });
        expect(body.totals).toEqual({
            byItem: { wash: { count: 2, points: 5 }, old: { count: 1, points: 1 } },
            totalCount: 3, totalPoints: 6, pendingCount: 1,
        });
    });

    it('people = 在籍の作業員・職長（記録なしは 0 の行）＋記録のある人（退職も）。並びは dispatchSortOrder → 名前', async () => {
        const { body } = await getSummary();
        expect(body.people!.map((p) => p.userId)).toEqual(['foreman1', 'worker1', 'retired', 'worker3']);
        expect(body.people!.find((p) => p.userId === 'foreman1')).toMatchObject({ role: 'foreman1', byItem: {}, totalCount: 0, totalPoints: 0, pendingCount: 0 });
        // 管理者・マネージャー・協力会社のメンバーは、記録が無ければ表の行に出ない
        expect(body.people!.some((p) => ['admin1', 'manager1', 'partner1'].includes(p.userId))).toBe(false);
    });

    it('eligiblePeople に管理者・マネージャーが入る（在籍・対象のロールだけ。協力会社のメンバー・退職は入らない）。role は小文字', async () => {
        const { body } = await getSummary();
        expect(body.eligiblePeople).toEqual([
            { userId: 'foreman1', displayName: '職長1', role: 'foreman1' },
            { userId: 'worker1', displayName: '作業員1', role: 'worker' },
            { userId: 'manager1', displayName: 'マネージャー1', role: 'manager' },
            { userId: 'worker3', displayName: 'あ作業員', role: 'worker' },
            { userId: 'admin1', displayName: '管理者1', role: 'admin' },
        ]);
    });

    it('items = 使用中の項目 ＋ この期間に記録のある項目（使っていない項目でも）', async () => {
        const { body } = await getSummary();
        expect(body.items!.map((i) => i.id)).toEqual(['wash', 'help', 'old']);
        expect(mock(prisma.evaluationPointItem.findMany).mock.calls[0][0].orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
    });

    it('記録が無い期間は、人ごとに全部 0。応答は no-store', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);
        const r = await getSummary();
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({ isActive: true });
        expect(r.body.totals).toEqual({ byItem: {}, totalCount: 0, totalPoints: 0, pendingCount: 0 });
        expect(r.body.items!.map((i) => i.id)).toEqual(['wash', 'help']);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    });
});

describe('GET /export', () => {
    it('職長は 403／type が無い・知らない値は 400／期間は必須', async () => {
        loginAs({ id: 'foremanA', role: 'foreman1', name: '職長A' });
        expect((await getExport('type=detail&startDate=2026-09-01&endDate=2026-09-30')).status).toBe(403);
        loginAs(ADMIN);
        for (const q of ['startDate=2026-09-01&endDate=2026-09-30', 'type=all&startDate=2026-09-01&endDate=2026-09-30', 'type=summary']) {
            const res = await getExport(q);
            expect([q, res.status, ((await res.json()) as { details?: string }).details]).toEqual([q, 400, '入力が不正です']);
        }
    });

    it('type=summary は GET /summary と同じ人・同じ並び・同じ数字（BOM 付き・CRLF・attachment）', async () => {
        const { body } = await getSummary();
        const res = await getExport('type=summary&startDate=2026-09-01&endDate=2026-09-30');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="evaluation_points_summary_2026-09-01_2026-09-30.csv"');
        const lines = await csvLines(res);
        expect(lines[0]).toBe('氏名,洗車,ヘルプ,片付け（旧）,合計回数,合計点,確認待ち件数');
        expect(lines.slice(1)).toEqual(body.people!.map((p) =>
            [p.displayName, ...body.items!.map((i) => String(p.byItem[i.id]?.count ?? 0)), p.totalCount, p.totalPoints, p.pendingCount].join(',')));
        expect(lines[2]).toBe('作業員1,2,0,0,2,5,1');
    });

    it('type=detail は 1行＝1記録（状態・入力元の言葉・日本時間の入力日時・引用符の付け方）', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            {
                id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'wash', itemName: '洗車', points: 2,
                status: 'pending', source: 'attendance', note: 'メモ, "引用"', createdBy: 'foremanA', createdByName: '職長A',
                createdAt: new Date('2026-09-30T15:05:00.000Z'), confirmedByName: null, confirmedAt: null,
            },
            {
                id: 'r2', userId: 'gone', date: utc0('2026-09-01'), itemId: 'wash', itemName: '洗車', points: 3,
                status: 'confirmed', source: 'manual', note: null, createdBy: 'admin1', createdByName: '管理者1',
                createdAt: new Date('2026-09-01T00:00:00.000Z'), confirmedByName: null, confirmedAt: null,
            },
        ]);
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'worker1', displayName: '作業員1' }]);
        const res = await getExport('type=detail&startDate=2026-09-01&endDate=2026-09-30');
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="evaluation_points_detail_2026-09-01_2026-09-30.csv"');
        const lines = await csvLines(res);
        expect(lines).toEqual([
            '日付,氏名,項目,点数,状態,付けた人,入力元,メモ,入力日時',
            '2026-09-30,作業員1,洗車,2,確認待ち,職長A,出勤簿入力,"メモ, ""引用""",2026-10-01 00:05',
            '2026-09-01,（不明）,洗車,3,確定,管理者1,評価ポイントの画面,,2026-09-01 09:00',
        ]);
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
        });
    });
});

// ---------------------------------------------------------------- 「ありがとう」（Phase 2）

const THANKS_ITEM = { id: '__thanks__', name: 'ありがとう', inputBy: 'thanks' };
const thanksSetting = (isActive: boolean) =>
    // pointsPerThanks（今の設定の点数）は、集計に使わないことを確かめるため、わざと大きい値にする
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive, pointsPerThanks: 100 });

/** 9月の「ありがとう」: 作業員1 が2回（1点＋3点）、退職した「い作業員」が1回、管理者1 が1回 */
const THANKS_ROWS = [
    { id: 't1', fromUserId: 'foreman1', toUserId: 'worker1', date: utc0('2026-09-05'), message: null, points: 1, createdAt: new Date('2026-09-05T01:00:00.000Z') },
    { id: 't2', fromUserId: 'worker3', toUserId: 'worker1', date: utc0('2026-09-06'), message: null, points: 3, createdAt: new Date('2026-09-06T01:00:00.000Z') },
    { id: 't3', fromUserId: 'worker1', toUserId: 'thanksOnly', date: utc0('2026-09-07'), message: null, points: 2, createdAt: new Date('2026-09-07T01:00:00.000Z') },
    { id: 't4', fromUserId: 'worker1', toUserId: 'admin1', date: utc0('2026-09-08'), message: null, points: 1, createdAt: new Date('2026-09-08T01:00:00.000Z') },
];
const THANKS_ONLY_USER = { id: 'thanksOnly', displayName: 'い作業員（退職）', role: 'WORKER', isActive: false, dispatchSortOrder: null };

describe('GET /summary の「ありがとう」', () => {
    it('「使う」で0件 → 仮の項目の列だけ、いちばん後ろに出る（回数 0）', async () => {
        thanksSetting(true);
        const { body } = await getSummary();
        expect(body.items!.map((i) => i.id)).toEqual(['wash', 'help', 'old', '__thanks__']);
        expect(body.items![3]).toEqual({ ...THANKS_ITEM, isActive: true });
        expect(body.people!.some((p) => '__thanks__' in p.byItem)).toBe(false);
        expect(body.totals!.byItem['__thanks__']).toBeUndefined();
        expect(body.totals).toMatchObject({ totalCount: 3, totalPoints: 6, pendingCount: 1 });
    });

    it('「使わない」で0件 → 列が出ない（設定の行が無いときと、応答が1文字も変わらない）', async () => {
        const withoutRow = await getSummary();
        thanksSetting(false);
        const inactive = await getSummary();
        expect(inactive.body.items!.map((i) => i.id)).toEqual(['wash', 'help', 'old']);
        expect(JSON.stringify(inactive.body)).toBe(JSON.stringify(withoutRow.body));
    });

    it('「使わない」でも、期間に1件あれば列が出る（isActive は false）', async () => {
        thanksSetting(false);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([THANKS_ROWS[0]]);
        const { body } = await getSummary();
        expect(body.items![body.items!.length - 1]).toEqual({ ...THANKS_ITEM, isActive: false });
    });

    it('もらった人の byItem・合計・合計の行に入る。点数は行の points の足し算（今の設定の点数は使わない）。確認待ちは変わらない', async () => {
        thanksSetting(true);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue(THANKS_ROWS);
        mock(prisma.user.findMany).mockResolvedValue([...USERS, THANKS_ONLY_USER]);
        const { body } = await getSummary();
        const w1 = body.people!.find((p) => p.userId === 'worker1')!;
        expect(w1).toEqual({
            userId: 'worker1', displayName: '作業員1', role: 'worker',
            byItem: { wash: { count: 2, points: 5 }, __thanks__: { count: 2, points: 4 } },
            totalCount: 4, totalPoints: 9, pendingCount: 1, pendingPoints: 5,
        });
        expect(body.totals).toEqual({
            byItem: { wash: { count: 2, points: 5 }, old: { count: 1, points: 1 }, __thanks__: { count: 4, points: 7 } },
            totalCount: 7, totalPoints: 13, pendingCount: 1,
        });
    });

    it('「ありがとう」だけをもらった人（記録が無い・在籍していない・管理者）も行に出る。人を引く条件にも足す。eligiblePeople は変わらない', async () => {
        const before = (await getSummary()).body.eligiblePeople;
        mock(prisma.user.findMany).mockClear();
        thanksSetting(true);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue(THANKS_ROWS);
        mock(prisma.user.findMany).mockResolvedValue([...USERS, THANKS_ONLY_USER]);
        const { body } = await getSummary();
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({
            OR: [{ isActive: true }, { id: { in: ['worker1', 'retired', 'thanksOnly', 'admin1'] } }],
        });
        expect(body.people!.map((p) => p.userId)).toEqual(['foreman1', 'worker1', 'retired', 'worker3', 'thanksOnly', 'admin1']);
        expect(body.people!.find((p) => p.userId === 'thanksOnly')).toEqual({
            userId: 'thanksOnly', displayName: 'い作業員（退職）', role: 'worker',
            byItem: { __thanks__: { count: 1, points: 2 } },
            totalCount: 1, totalPoints: 2, pendingCount: 0, pendingPoints: 0,
        });
        expect(body.people!.find((p) => p.userId === 'admin1')).toMatchObject({ role: 'admin', totalCount: 1, totalPoints: 1 });
        expect(body.eligiblePeople).toEqual(before);
    });

    it('記録が1件も無くても、「ありがとう」をもらった人だけで人を引く条件に足す', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([THANKS_ROWS[2]]);
        await getSummary();
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({
            OR: [{ isActive: true }, { id: { in: ['thanksOnly'] } }],
        });
    });

    it('「ありがとう」を読む where は期間だけ・設定は id "default" を読む', async () => {
        await getSummary();
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0]).toEqual({
            where: { date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            select: { toUserId: true, points: true },
        });
        expect(mock(prisma.evaluationPointThanksSetting.findUnique).mock.calls[0][0].where).toEqual({ id: 'default' });
    });
});

describe('GET /export の「ありがとう」', () => {
    it('type=summary の見出しのいちばん後ろの項目に「ありがとう」の列（回数）', async () => {
        thanksSetting(true);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue(THANKS_ROWS);
        mock(prisma.user.findMany).mockResolvedValue([...USERS, THANKS_ONLY_USER]);
        const lines = await csvLines(await getExport('type=summary&startDate=2026-09-01&endDate=2026-09-30'));
        expect(lines[0]).toBe('氏名,洗車,ヘルプ,片付け（旧）,ありがとう,合計回数,合計点,確認待ち件数');
        expect(lines).toContain('作業員1,2,0,0,2,4,9,1');
        expect(lines).toContain('い作業員（退職）,0,0,0,1,1,2,0');
    });

    it('type=detail に「ありがとう」の行が足され、日付の古い順 → 入れた日時の古い順で、点数表の記録と混ざる', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            {
                id: 'r2', userId: 'gone', date: utc0('2026-09-01'), itemId: 'wash', itemName: '洗車', points: 3,
                status: 'confirmed', source: 'manual', note: null, createdBy: 'admin1', createdByName: '管理者1',
                createdAt: new Date('2026-09-01T00:00:00.000Z'), confirmedByName: null, confirmedAt: null,
            },
            {
                id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'wash', itemName: '洗車', points: 2,
                status: 'pending', source: 'attendance', note: 'メモ, "引用"', createdBy: 'foremanA', createdByName: '職長A',
                createdAt: new Date('2026-09-30T15:05:00.000Z'), confirmedByName: null, confirmedAt: null,
            },
        ]);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([
            // 点数表の記録と、日付も入れた日時も同じ → 点数表の記録が先
            { id: 'ta', fromUserId: 'foreman1', toUserId: 'worker1', date: utc0('2026-09-01'), message: '助かりました, "本当に"', points: 1, createdAt: new Date('2026-09-01T00:00:00.000Z') },
            { id: 'tb', fromUserId: 'ghost', toUserId: 'worker1', date: utc0('2026-09-15'), message: null, points: 3, createdAt: new Date('2026-09-15T03:00:00.000Z') },
            // 同じ日で、点数表の記録より先に入れた → 先
            { id: 'tc', fromUserId: 'foreman1', toUserId: 'nobody', date: utc0('2026-09-30'), message: null, points: 1, createdAt: new Date('2026-09-30T14:00:00.000Z') },
        ]);
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'worker1', displayName: '作業員1' }, { id: 'foreman1', displayName: '職長1' }]);
        const lines = await csvLines(await getExport('type=detail&startDate=2026-09-01&endDate=2026-09-30'));
        expect(lines).toEqual([
            '日付,氏名,項目,点数,状態,付けた人,入力元,メモ,入力日時',
            '2026-09-01,（不明）,洗車,3,確定,管理者1,評価ポイントの画面,,2026-09-01 09:00',
            '2026-09-01,作業員1,ありがとう,1,確定,職長1,ありがとう,"助かりました, ""本当に""",2026-09-01 09:00',
            '2026-09-15,作業員1,ありがとう,3,確定,（不明）,ありがとう,,2026-09-15 12:00',
            '2026-09-30,（不明）,ありがとう,1,確定,職長1,ありがとう,,2026-09-30 23:00',
            '2026-09-30,作業員1,洗車,2,確認待ち,職長A,出勤簿入力,"メモ, ""引用""",2026-10-01 00:05',
        ]);
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
        });
        // もらった人・送った人の名前も、同じ1回の読み込みで引く
        expect(mock(prisma.user.findMany).mock.calls).toHaveLength(1);
        expect([...mock(prisma.user.findMany).mock.calls[0][0].where.id.in].sort()).toEqual(['foreman1', 'ghost', 'gone', 'nobody', 'worker1']);
    });

    it('type=detail の「ありがとう」の行: = + - @ で始まるひとこと・氏名は、頭に \' を付けて出す（Excel が式として読まないように）', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([
            { id: 't1', fromUserId: 'foreman1', toUserId: 'worker1', date: utc0('2026-09-01'), message: '=HYPERLINK("http://example.com","押して")', points: 1, createdAt: new Date('2026-09-01T00:00:00.000Z') },
            { id: 't2', fromUserId: 'foreman1', toUserId: 'worker1', date: utc0('2026-09-02'), message: '+1 助かった', points: 1, createdAt: new Date('2026-09-02T00:00:00.000Z') },
            { id: 't3', fromUserId: 'atmark', toUserId: 'worker1', date: utc0('2026-09-03'), message: '-5分で片づけてくれた', points: 1, createdAt: new Date('2026-09-03T00:00:00.000Z') },
            { id: 't4', fromUserId: 'foreman1', toUserId: 'worker1', date: utc0('2026-09-04'), message: 'ふつうのひとこと', points: 1, createdAt: new Date('2026-09-04T00:00:00.000Z') },
        ]);
        mock(prisma.user.findMany).mockResolvedValue([
            { id: 'worker1', displayName: '作業員1' }, { id: 'foreman1', displayName: '職長1' }, { id: 'atmark', displayName: '@名前' },
        ]);
        const lines = await csvLines(await getExport('type=detail&startDate=2026-09-01&endDate=2026-09-30'));
        expect(lines).toEqual([
            '日付,氏名,項目,点数,状態,付けた人,入力元,メモ,入力日時',
            '2026-09-01,作業員1,ありがとう,1,確定,職長1,ありがとう,"\'=HYPERLINK(""http://example.com"",""押して"")",2026-09-01 09:00',
            '2026-09-02,作業員1,ありがとう,1,確定,職長1,ありがとう,\'+1 助かった,2026-09-02 09:00',
            '2026-09-03,作業員1,ありがとう,1,確定,\'@名前,ありがとう,\'-5分で片づけてくれた,2026-09-03 09:00',
            '2026-09-04,作業員1,ありがとう,1,確定,職長1,ありがとう,ふつうのひとこと,2026-09-04 09:00',
        ]);
    });

    it('「ありがとう」が0件なら、type=detail に「ありがとう」の行は無い（設定が「使う」でも）', async () => {
        thanksSetting(true);
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([{
            id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'wash', itemName: '洗車', points: 2,
            status: 'confirmed', source: 'manual', note: null, createdBy: 'admin1', createdByName: '管理者1',
            createdAt: new Date('2026-09-30T00:00:00.000Z'), confirmedByName: null, confirmedAt: null,
        }]);
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'worker1', displayName: '作業員1' }]);
        const lines = await csvLines(await getExport('type=detail&startDate=2026-09-01&endDate=2026-09-30'));
        expect(lines).toEqual([
            '日付,氏名,項目,点数,状態,付けた人,入力元,メモ,入力日時',
            '2026-09-30,作業員1,洗車,2,確定,管理者1,評価ポイントの画面,,2026-09-30 09:00',
        ]);
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({ id: { in: ['worker1'] } });
    });
});
