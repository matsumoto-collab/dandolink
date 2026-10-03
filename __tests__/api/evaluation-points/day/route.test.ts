/**
 * @jest-environment node
 *
 * GET・PUT /api/evaluation-points/day（「出勤簿入力」のポイントのボタン用）のテスト。
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」は、返ってきた値ではなく、findFirst・findMany・deleteMany に渡した引数で確かめる。
 *
 * 日付: 「先の日付」には遠い先（2099年）、ほかは過去の日付（2026-09-30・2026-10-01）を使う。
 * 「今日」を日本時間で決めているかを確かめるテストだけ、時計を固定する（freezeNow）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT } from '@/app/api/evaluation-points/day/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

const DAY_BEFORE = '2026-09-30'; // 点数を変える前
const DAY_AFTER = '2026-10-01';  // 点数を変えた日（適用開始日）
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

interface DayRecordBody { id: string; itemId: string; itemName: string; status: string; createdBy: string; createdByName: string; canRemove: boolean }
interface DayMemberBody { userId: string; eligible: boolean; records: DayRecordBody[] }
interface PutBody { result?: string; member?: DayMemberBody; error?: string; details?: string }
interface GetBody { date?: string; foremanId?: string; items?: { id: string; name: string; description: string | null }[]; members?: DayMemberBody[]; error?: string; details?: string }

const putRaw = async (rawBody: string) => {
    const res = await PUT(new NextRequest('http://localhost/api/evaluation-points/day', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    }));
    return { status: res.status, body: (await res.json()) as PutBody, res };
};
const put = (over: Record<string, unknown> = {}) =>
    putRaw(JSON.stringify({ foremanId: 'foremanA', date: DAY_BEFORE, userId: 'worker1', itemId: 'wash', on: true, ...over }));

const get = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/evaluation-points/day?${query}`));
    return { status: res.status, body: (await res.json()) as GetBody, res };
};

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string; username?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });

/** 「今」を固定する（Date だけを差し替える。タイマーや Promise の動きは本物のまま）。戻すのは jest.useRealTimers() */
const freezeNow = (iso: string) =>
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

/** すでに付いている記録（findFirst が返す行＝全部の列） */
const recordRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'worker1', date: utc0(DAY_BEFORE), itemId: 'wash', itemName: '洗車', points: 2,
    rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-09-30T09:00:00.000Z'), updatedAt: new Date('2026-09-30T09:00:00.000Z'), ...over,
});

const ITEMS: Record<string, { id: string; name: string; isActive: boolean; inputBy: string }> = {
    wash: { id: 'wash', name: '洗車', isActive: true, inputBy: 'foreman' },
    old: { id: 'old', name: '片付け（旧）', isActive: false, inputBy: 'foreman' },
    holiday: { id: 'holiday', name: '休日出勤', isActive: true, inputBy: 'admin' },
};

/** 記録もログも、何も書いていないこと */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRecord.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });

    // 職長A の班: worker1 と、協力会社のメンバー。user.findMany は「isActive: true で絞ったあと」をテストが決めて返す
    mock(prisma.projectAssignment.findMany).mockResolvedValue([{ confirmedWorkerIds: '["worker1","partner1"]' }]);
    mock(prisma.user.findMany).mockResolvedValue([
        { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2' },
        { id: 'worker1', displayName: '作業員1', role: 'WORKER' },
        { id: 'partner1', displayName: '協力会社のメンバー', role: 'PARTNER_MEMBER' },
    ]);
    mock(prisma.evaluationPointItem.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) => ITEMS[where.id] ?? null);
    mock(prisma.evaluationPointItem.findMany).mockResolvedValue([{ id: 'wash' }, { id: 'old' }]);
    // 洗車は 9/1 から 2点、10/1 から 3点
    mock(prisma.evaluationPointRate.findMany).mockResolvedValue([
        { id: 'rate1', itemId: 'wash', points: 2, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
        { id: 'rate2', itemId: 'wash', points: 3, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
    ]);
    mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(null);   // まだ付いていない
    mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);       // 応答の member 用の読み直し
    // createManyAndReturn は「入った行の配列」を返すようにする
    mock(prisma.evaluationPointRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
        data.map((d, i) => ({ id: `new-${i + 1}`, ...d })));
    // deleteMany は { count } を返すようにする（jest.fn() のままだと undefined が返り、route が 500 になる）
    mock(prisma.evaluationPointRecord.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
});

afterEach(() => {
    jest.useRealTimers();
});

describe('PUT /api/evaluation-points/day: 確かめる順番（合わなければ、その時点で断る。何も保存しない）', () => {
    it('ログインしていなければ 401', async () => {
        mock(requireAuth).mockResolvedValue({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) });
        expect((await put()).status).toBe(401);
        noWrites();
    });

    it('作業員は 403。foremanId に自分の ID を指定しても 403（職長本人は必ず班に入るので、ロールで止める）', async () => {
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });
        for (const foremanId of ['foremanA', 'worker1']) {
            const r = await put({ foremanId, userId: 'worker1' });
            expect([foremanId, r.status, r.body.error]).toEqual([foremanId, 403, '権限がありません']);
        }
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
        noWrites();
    });

    it('入力の形が違う → 400「入力が不正です」（JSON として読めない body も 400。500 にしない）', async () => {
        // 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る
        for (const over of [{ on: 'true' }, { on: undefined }, { foremanId: 1 }, { userId: null }, { itemId: undefined }, { date: 20260930 }]) {
            const r = await put(over);
            expect([JSON.stringify(over), r.status, r.body.error, r.body.details]).toEqual([JSON.stringify(over), 400, 'Validation Error', '入力が不正です']);
        }
        for (const raw of ['これは JSON ではない', '"文字列"', 'null', '[]']) {
            const r = await putRaw(raw);
            expect([raw, r.status, r.body.details]).toEqual([raw, 400, '入力が不正です']);
        }
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
        noWrites();
    });

    it('日付の形が違う → 400「日付が不正です」／先の日付 → 400「先の日付には付けられません」（取り消しも断る）', async () => {
        for (const date of ['2026-02-30', '2026/09/30', '2026-9-30', '']) {
            const r = await put({ date });
            expect([date, r.status, r.body.details]).toEqual([date, 400, '日付が不正です']);
        }
        for (const on of [true, false]) {
            const r = await put({ date: '2099-12-31', on });
            expect([on, r.status, r.body.error]).toEqual([on, 400, '先の日付には付けられません']);
        }
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
        noWrites();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前日でも、日本の日付が今日なら付けられる）', async () => {
        freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
        expect((await put({ date: '2026-11-01' })).body.result).toBe('added');
        expect((await put({ date: '2026-11-02' })).body.error).toBe('先の日付には付けられません');

        freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
        expect((await put({ date: '2026-11-01' })).body.error).toBe('先の日付には付けられません');
        expect((await put({ date: '2026-10-31' })).body.result).toBe('added');
    });

    it('職長が他の職長の foremanId を指定したら 403。DB は読まない・書かない', async () => {
        const r = await put({ foremanId: 'foremanB' });
        expect([r.status, r.body.error]).toEqual([403, '他の職長の班の評価ポイントは扱えません']);
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
        noWrites();
    });

    it('班にいない人は 400／協力会社のメンバー（DB の値が PARTNER_MEMBER のように大文字でも）は 400', async () => {
        const notMember = await put({ userId: 'outsider' });
        expect([notMember.status, notMember.body.error]).toEqual([400, 'この日の班のメンバーではありません']);

        const partner = await put({ userId: 'partner1' });
        expect([partner.status, partner.body.error]).toEqual([400, '評価ポイントの対象外の人です']);

        noWrites();
    });
});

describe('PUT /api/evaluation-points/day: 付ける（on: true）', () => {
    it("自分の行は status: 'pending' で入る。他の人の行は 'confirmed'", async () => {
        const own = await put({ userId: 'foremanA' });
        expect([own.status, own.body.result]).toEqual([200, 'added']);
        const other = await put({ userId: 'worker1' });
        expect([other.status, other.body.result]).toEqual([200, 'added']);

        const calls = mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls.map((c) => c[0] as { data: Record<string, unknown>[]; skipDuplicates: boolean });
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({
            data: [{
                userId: 'foremanA', date: utc0(DAY_BEFORE), itemId: 'wash', itemName: '洗車', points: 2, rateId: 'rate1',
                status: 'pending', source: 'attendance', foremanId: 'foremanA', createdBy: 'foremanA', createdByName: '職長A',
            }],
            skipDuplicates: true,
        });
        expect(calls[1].data).toEqual([expect.objectContaining({ userId: 'worker1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', itemName: '洗車' })]);
    });

    it('管理者が職長A の班で付けたとき: foremanId は班の職長、付けた人（createdBy）は管理者', async () => {
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect((await put()).body.result).toBe('added');
        const data = (mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls[0][0] as { data: Record<string, unknown>[] }).data[0];
        expect(data).toMatchObject({ foremanId: 'foremanA', createdBy: 'admin1', createdByName: '管理者', status: 'confirmed' });
    });

    it('表示名が無いセッションでは、名前の写しはログイン名（username）。id にログイン名は使わない', async () => {
        loginAs({ id: 'foremanA', role: 'foreman2' });
        expect((await put()).body.result).toBe('added');
        const data = (mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls[0][0] as { data: Record<string, unknown>[] }).data[0];
        expect(data).toMatchObject({ createdBy: 'foremanA', createdByName: 'login-foremanA' });
    });

    it('点数は記録の日付で決まる（点数を変える前の日付には前の点数）', async () => {
        const dataOf = async (date: string) => {
            mock(prisma.evaluationPointRecord.createManyAndReturn).mockClear();
            expect((await put({ date })).body.result).toBe('added');
            return (mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls[0][0] as { data: Record<string, unknown>[] }).data[0];
        };
        expect(await dataOf(DAY_BEFORE)).toMatchObject({ points: 2, rateId: 'rate1', date: utc0(DAY_BEFORE) });
        expect(await dataOf(DAY_AFTER)).toMatchObject({ points: 3, rateId: 'rate2', date: utc0(DAY_AFTER) });
        // 項目を作る前の日付（どの適用開始日よりも前）には、最初の点数
        expect(await dataOf('2026-08-01')).toMatchObject({ points: 2, rateId: 'rate1' });
    });

    it('点数の行が1つも無い項目は 400「この項目には点数が設定されていません」。何も保存しない', async () => {
        mock(prisma.evaluationPointRate.findMany).mockResolvedValue([]);
        const r = await put();
        expect([r.status, r.body.error]).toEqual([400, 'この項目には点数が設定されていません']);
        noWrites();
    });

    it("同じボタンを2回送っても記録は1件（2回目は 'unchanged'）", async () => {
        expect((await put()).body.result).toBe('added');
        // 2回目: もう付いている
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put()).body.result).toBe('unchanged');
        expect(prisma.evaluationPointRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
    });

    it("同時に別の端末が先に入れていて入らなかったら 'unchanged'。ログは書かない", async () => {
        mock(prisma.evaluationPointRecord.createManyAndReturn).mockResolvedValue([]); // skipDuplicates で入らなかった
        const r = await put();
        expect([r.status, r.body.result]).toEqual([200, 'unchanged']);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });

    it("管理者だけの項目・使っていない項目・知らない項目は 'rejected'（管理者が押しても）", async () => {
        for (const role of ['foreman2', 'admin']) {
            loginAs({ id: role === 'admin' ? 'admin1' : 'foremanA', role, name: role });
            for (const itemId of ['holiday', 'old', 'ghost']) {
                const r = await put({ itemId });
                expect([role, itemId, r.status, r.body.result]).toEqual([role, itemId, 200, 'rejected']);
            }
        }
        noWrites();
    });
});

describe('PUT /api/evaluation-points/day: 取り消す（on: false）', () => {
    it("他の人が付けた記録を職長が取り消そうとすると 'blocked' で、記録は残る。管理者は取り消せる", async () => {
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow({ createdBy: 'admin1', createdByName: '管理者' }));
        const blocked = await put({ on: false });
        expect([blocked.status, blocked.body.result]).toEqual([200, 'blocked']);
        noWrites();

        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow());
        const removed = await put({ on: false });
        expect([removed.status, removed.body.result]).toEqual([200, 'removed']);
        // 取り消しの条件は「記録の ID」と「読んだときの status」
        expect(prisma.evaluationPointRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.evaluationPointRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
    });

    it("自分の行: 確認待ちは取り下げられる（条件の status は 'pending'）。認められた後は 'blocked'", async () => {
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow({ id: 'p1', userId: 'foremanA', status: 'pending' }));
        expect((await put({ userId: 'foremanA', on: false })).body.result).toBe('removed');
        expect(prisma.evaluationPointRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' } });

        mock(prisma.evaluationPointRecord.deleteMany).mockClear();
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow({ id: 'p1', userId: 'foremanA', status: 'confirmed' }));
        expect((await put({ userId: 'foremanA', on: false })).body.result).toBe('blocked');
        expect(prisma.evaluationPointRecord.deleteMany).not.toHaveBeenCalled();
    });

    it("「使わない」にした項目の記録は取り消せる。もう無い記録の取り消しは 'unchanged'", async () => {
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow({ id: 'o1', itemId: 'old', itemName: '片付け（旧）' }));
        expect((await put({ itemId: 'old', on: false })).body.result).toBe('removed');

        mock(prisma.evaluationPointRecord.deleteMany).mockClear();
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(null);
        expect((await put({ on: false })).body.result).toBe('unchanged');
        expect(prisma.evaluationPointRecord.deleteMany).not.toHaveBeenCalled();
    });
});

describe('PUT /api/evaluation-points/day: ログと応答', () => {
    it('記録が入った・消えたときだけ、ログが1行書かれる', async () => {
        // 入った
        await put();
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0]).toEqual({
            data: {
                action: 'record_added', actorId: 'foremanA', actorName: '職長A',
                targetUserId: 'worker1', itemId: 'wash', recordId: 'new-1', recordDate: utc0(DAY_BEFORE),
                detail: { itemName: '洗車', points: 2, status: 'confirmed', source: 'attendance' },
            },
        });

        // 消えた
        mock(prisma.evaluationPointLog.create).mockClear();
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put({ on: false })).body.result).toBe('removed');
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
        const removedLog = (mock(prisma.evaluationPointLog.create).mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(removedLog).toMatchObject({
            action: 'record_removed', actorId: 'foremanA', actorName: '職長A',
            targetUserId: 'worker1', itemId: 'wash', recordId: 'r1', recordDate: utc0(DAY_BEFORE),
        });
        // 取り消した記録の全部の列が残る（日付は 'YYYY-MM-DD'）
        expect(removedLog.detail).toEqual({ ...recordRow(), date: DAY_BEFORE });

        // もう無かった（消えた件数が 0）→ 'unchanged'・ログなし
        mock(prisma.evaluationPointLog.create).mockClear();
        mock(prisma.evaluationPointRecord.deleteMany).mockResolvedValue({ count: 0 });
        expect((await put({ on: false })).body.result).toBe('unchanged');
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });

    it('応答の member は、保存のあとに読み直した記録。Cache-Control は no-store', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            { id: 'new-1', userId: 'worker1', itemId: 'wash', itemName: '洗車', status: 'confirmed', createdBy: 'foremanA', createdByName: '職長A' },
        ]);
        const r = await put();
        expect(r.body.member).toEqual({
            userId: 'worker1', eligible: true,
            records: [{ id: 'new-1', itemId: 'wash', itemName: '洗車', status: 'confirmed', createdBy: 'foremanA', createdByName: '職長A', canRemove: true }],
        });
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('今の記録は「その人・その日（UTC 0時の印）・その項目」で読む（モックは where を見ないので、渡した引数を確かめる）', async () => {
        await put();
        expect(prisma.evaluationPointRecord.findFirst).toHaveBeenCalledWith({
            where: { userId: 'worker1', date: utc0(DAY_BEFORE), itemId: 'wash' },
        });
        // 応答の member 用の読み直しも、その人・その日・職長向けの項目だけ
        expect(prisma.evaluationPointItem.findMany).toHaveBeenCalledWith({ where: { inputBy: 'foreman' }, select: { id: true } });
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0]).toMatchObject({
            where: { userId: { in: ['worker1'] }, date: utc0(DAY_BEFORE), itemId: { in: ['wash', 'old'] } },
        });
    });
});

describe('GET /api/evaluation-points/day', () => {
    it('職長が他の職長の班を指定したら 403。作業員は 403「権限がありません」', async () => {
        const other = await get(`foremanId=foremanB&date=${DAY_BEFORE}`);
        expect([other.status, other.body.error]).toEqual([403, '他の職長の班の評価ポイントは扱えません']);
        loginAs({ id: 'worker1', role: 'worker' });
        for (const foremanId of ['foremanA', 'worker1']) {
            const r = await get(`foremanId=${foremanId}&date=${DAY_BEFORE}`);
            expect([foremanId, r.status, r.body.error]).toEqual([foremanId, 403, '権限がありません']);
        }
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });

    it('foremanId・date が無い → 400「入力が不正です」／日付の形が違う → 400「日付が不正です」', async () => {
        for (const query of ['', `foremanId=foremanA`, `date=${DAY_BEFORE}`]) {
            const r = await get(query);
            expect([query, r.status, r.body.details]).toEqual([query, 400, '入力が不正です']);
        }
        const bad = await get('foremanId=foremanA&date=2026-02-30');
        expect([bad.status, bad.body.details]).toEqual([400, '日付が不正です']);
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });

    it('先の日付は、DB を読まずに空を返す。他の職長の班は、先の日付でも 403（空を返すのは、権限を確かめたあと）', async () => {
        const r = await get('foremanId=foremanA&date=2099-12-31');
        expect([r.status, r.body]).toEqual([200, { date: '2099-12-31', foremanId: 'foremanA', items: [], members: [] }]);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect((await get('foremanId=foremanB&date=2099-12-31')).status).toBe(403);
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前日でも、日本の日付が今日なら返る）', async () => {
        freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
        expect((await get('foremanId=foremanA&date=2026-11-01')).body.members?.length).toBe(3);
        expect((await get('foremanId=foremanA&date=2026-11-02')).body.members).toEqual([]);

        freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
        expect((await get('foremanId=foremanA&date=2026-11-01')).body.members).toEqual([]);
        expect((await get('foremanId=foremanA&date=2026-10-31')).body.members?.length).toBe(3);
    });

    it('項目は「職長向け」を sortOrder 順に引いて、使用中だけを返す（点数は返さない）。記録は「班の人・その日・職長向けの項目」で引く', async () => {
        mock(prisma.evaluationPointItem.findMany).mockResolvedValue([
            { id: 'wash', name: '洗車', description: '帰りに車を洗った', isActive: true },
            { id: 'old', name: '片付け（旧）', description: null, isActive: false },
        ]);
        const r = await get(`foremanId=foremanA&date=${DAY_BEFORE}`);
        expect(r.status).toBe(200);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect([r.body.date, r.body.foremanId]).toEqual([DAY_BEFORE, 'foremanA']);
        expect(r.body.items).toEqual([{ id: 'wash', name: '洗車', description: '帰りに車を洗った' }]);
        expect(mock(prisma.evaluationPointItem.findMany).mock.calls[0][0]).toMatchObject({ where: { inputBy: 'foreman' }, orderBy: { sortOrder: 'asc' } });
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0]).toMatchObject({
            where: {
                userId: { in: ['foremanA', 'worker1', 'partner1'] },
                date: utc0(DAY_BEFORE),
                itemId: { in: ['wash', 'old'] },
            },
        });
    });

    it('eligible・status・canRemove は、lib/evaluationPoints.ts の関数どおり', async () => {
        mock(prisma.evaluationPointItem.findMany).mockResolvedValue([{ id: 'wash', name: '洗車', description: null, isActive: true }]);
        const row = (id: string, userId: string, status: string, createdBy: string) =>
            ({ id, userId, itemId: 'wash', itemName: '洗車', status, createdBy, createdByName: `${createdBy}の名前` });
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            row('mine', 'worker1', 'confirmed', 'foremanA'),
            row('admins', 'worker1', 'confirmed', 'admin1'),
            row('self-pending', 'foremanA', 'pending', 'foremanA'),
            row('self-confirmed', 'foremanA', 'confirmed', 'foremanA'),
        ]);
        const r = await get(`foremanId=foremanA&date=${DAY_BEFORE}`);
        const members = r.body.members ?? [];
        expect(Object.fromEntries(members.map((m) => [m.userId, m.eligible]))).toEqual({ foremanA: true, worker1: true, partner1: false });
        const records = members.flatMap((m) => m.records);
        expect(Object.fromEntries(records.map((x) => [x.id, [x.status, x.canRemove, x.createdBy, x.createdByName]]))).toEqual({
            mine: ['confirmed', true, 'foremanA', 'foremanAの名前'],
            admins: ['confirmed', false, 'admin1', 'admin1の名前'],
            'self-pending': ['pending', true, 'foremanA', 'foremanAの名前'],
            'self-confirmed': ['confirmed', false, 'foremanA', 'foremanAの名前'],
        });
    });

    it('管理者・マネージャーは、どの職長の班も読める', async () => {
        for (const role of ['admin', 'manager']) {
            loginAs({ id: `${role}1`, role, name: role });
            expect((await get(`foremanId=foremanA&date=${DAY_BEFORE}`)).status).toBe(200);
        }
    });
});
