/**
 * @jest-environment node
 *
 * 評価ポイントの記録の API のテスト（docs/指示書_評価ポイント.md の 6-3・8-1）。
 *   GET・POST・PATCH /api/evaluation-points/records
 *   DELETE /api/evaluation-points/records/[id]
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」は、findMany・updateMany・deleteMany に渡した引数で確かめる。
 * 日付: 「先の日付」には遠い先（2099年）、ほかは過去の日付を使う。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/evaluation-points/records/route';
import { DELETE } from '@/app/api/evaluation-points/records/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
const FOREMAN = { id: 'foremanA', role: 'foreman1', name: '職長A' };

const jsonRequest = (path: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

interface RecordBody { id: string; userId: string; userName: string; date: string; status: string; source: string; note: string | null; canRemove: boolean; canConfirm: boolean; points: number; itemName: string }
interface Body { error?: string; details?: string; ok?: boolean; record?: RecordBody; records?: RecordBody[]; confirmed?: number; skipped?: number }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body });

const getRecords = (query: string) => GET(jsonRequest(`/api/evaluation-points/records?${query}`, 'GET')).then(read);
const postRecord = (body: unknown) => POST(jsonRequest('/api/evaluation-points/records', 'POST', body)).then(read);
const patchRecords = (body: unknown) => PATCH(jsonRequest('/api/evaluation-points/records', 'PATCH', body)).then(read);
const deleteRecord = (id: string) => DELETE(jsonRequest(`/api/evaluation-points/records/${id}`, 'DELETE'), { params: { id } }).then(read);

/** 記録の行（全部の列） */
const recordRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'wash', itemName: '洗車', points: 2,
    rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-09-30T09:00:00.000Z'), updatedAt: new Date('2026-09-30T09:00:00.000Z'), ...over,
});

const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRecord.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    expect(prisma.evaluationPointLog.createMany).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);

    mock(prisma.user.findMany).mockResolvedValue([
        { id: 'worker1', displayName: '作業員1' },
        { id: 'admin1', displayName: '管理者1' },
    ]);
    mock(prisma.user.findUnique).mockResolvedValue({ id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true });
    mock(prisma.evaluationPointItem.findUnique).mockResolvedValue({ id: 'wash', name: '洗車', isActive: true });
    // 洗車は 9/1 から 2点、10/1 から 3点
    mock(prisma.evaluationPointRate.findMany).mockResolvedValue([
        { id: 'rate1', itemId: 'wash', points: 2, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
        { id: 'rate2', itemId: 'wash', points: 3, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
    ]);
    mock(prisma.evaluationPointRecord.findFirst).mockResolvedValue(null);
    mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
        data.map((d, i) => ({
            id: `new-${i + 1}`, confirmedBy: null, confirmedByName: null, confirmedAt: null,
            createdAt: new Date('2026-10-02T03:00:00.000Z'), updatedAt: new Date('2026-10-02T03:00:00.000Z'), ...d,
        })));
    mock(prisma.evaluationPointRecord.updateMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointRecord.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
    mock(prisma.evaluationPointLog.createMany).mockResolvedValue({ count: 1 });
});

// ================================================================ 権限

describe('権限: admin・manager だけ', () => {
    it('職長・作業員は、どの操作も 403「権限がありません」で、何も読まず書かない', async () => {
        for (const user of [FOREMAN, { id: 'worker1', role: 'worker', name: '作業員1' }]) {
            loginAs(user);
            const results = [
                await getRecords('status=pending'),
                await postRecord({ userId: 'worker1', date: '2026-09-30', itemId: 'wash' }),
                await patchRecords({ action: 'confirm', ids: ['r1'] }),
                await deleteRecord('r1'),
            ];
            for (const r of results) expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
        expect(prisma.evaluationPointRecord.findUnique).not.toHaveBeenCalled();
        noWrites();
    });

    it('マネージャーは使える（一覧・認める）', async () => {
        loginAs(MANAGER);
        expect((await getRecords('status=pending')).status).toBe(200);
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([recordRow({ id: 'ok', status: 'pending', createdBy: 'worker1' })]);
        expect((await patchRecords({ action: 'confirm', ids: ['ok'] })).body).toEqual({ confirmed: 1, skipped: 0 });
        expect(mock(prisma.evaluationPointRecord.updateMany).mock.calls[0][0].data).toMatchObject({ confirmedBy: 'manager1', confirmedByName: 'マネージャー1' });
    });

    it('ログインしていなければ 401', async () => {
        mock(requireAuth).mockResolvedValue({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) });
        expect((await getRecords('status=pending')).status).toBe(401);
    });
});

// ================================================================ GET

describe('GET /records', () => {
    it('status=pending は期間なしで、全期間の確認待ちが返る（where に date が無い）', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            recordRow({ id: 'p1', status: 'pending', userId: 'worker1', createdBy: 'worker1' }),
        ]);
        const r = await getRecords('status=pending');
        expect(r.status).toBe(200);
        const args = mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0];
        expect(args.where).toEqual({ status: 'pending' });
        expect(args.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
        expect(r.body.records).toHaveLength(1);
        expect(r.body.records![0]).toMatchObject({ id: 'p1', userName: '作業員1', date: '2026-09-30', status: 'pending', canConfirm: true, canRemove: true });
    });

    it('status が無いとき・confirmed のときは、期間が無ければ 400「入力が不正です」', async () => {
        for (const q of ['', 'status=confirmed', 'userId=worker1', 'status=pending&startDate=2026-09-01']) {
            const r = await getRecords(q);
            expect([q, r.status, r.body.details]).toEqual([q, 400, '入力が不正です']);
        }
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
    });

    it('日付の形が違う・開始 > 終了 は 400「日付が不正です」／status が知らない値は 400「入力が不正です」', async () => {
        for (const q of ['startDate=2026-02-30&endDate=2026-03-01', 'startDate=2026/09/01&endDate=2026-09-30', 'startDate=2026-10-01&endDate=2026-09-30']) {
            const r = await getRecords(q);
            expect([q, r.status, r.body.details]).toEqual([q, 400, '日付が不正です']);
        }
        const bad = await getRecords('status=all&startDate=2026-09-01&endDate=2026-09-30');
        expect([bad.status, bad.body.details]).toEqual([400, '入力が不正です']);
    });

    it('期間と userId で絞る（終了日は翌日より前）。氏名は isActive で絞らずに引く', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([recordRow()]);
        const r = await getRecords('startDate=2026-09-01&endDate=2026-09-30&userId=worker1');
        expect(r.status).toBe(200);
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
            userId: 'worker1',
        });
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({ id: { in: ['worker1'] } });
    });

    it('canRemove・canConfirm は、操作している人から見た値（自分の確認待ちは認められない・取り下げはできる）', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            recordRow({ id: 'own', userId: 'admin1', status: 'pending', createdBy: 'admin1' }),
            recordRow({ id: 'other', userId: 'worker1', status: 'pending', createdBy: 'worker1' }),
            recordRow({ id: 'ownConfirmed', userId: 'admin1', status: 'confirmed', createdBy: 'manager1' }),
        ]);
        const r = await getRecords('status=pending');
        const byId = Object.fromEntries(r.body.records!.map((x) => [x.id, { canConfirm: x.canConfirm, canRemove: x.canRemove }]));
        expect(byId).toEqual({
            own: { canConfirm: false, canRemove: true },
            other: { canConfirm: true, canRemove: true },
            ownConfirmed: { canConfirm: false, canRemove: false },
        });
    });
});

// ================================================================ POST

describe('POST /records', () => {
    const body = (over: Record<string, unknown> = {}) => ({ userId: 'worker1', date: '2026-09-30', itemId: 'wash', ...over });

    it('他の人に付けると確定。点数は記録の日付に有効な点数・source は manual・foremanId は null。ログは1行', async () => {
        const r = await postRecord(body({ note: '  洗車場まで  ' }));
        expect(r.status).toBe(201);
        const args = mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls[0][0];
        expect(args.skipDuplicates).toBe(true);
        expect(args.data).toEqual([{
            userId: 'worker1', date: utc0('2026-09-30'), itemId: 'wash', itemName: '洗車', points: 2, rateId: 'rate1',
            status: 'confirmed', source: 'manual', foremanId: null, note: '洗車場まで',
            createdBy: 'admin1', createdByName: '管理者1',
        }]);
        expect(r.body.record).toMatchObject({ id: 'new-1', userName: '作業員1', date: '2026-09-30', status: 'confirmed', points: 2, note: '洗車場まで' });
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toMatchObject({
            action: 'record_added', actorId: 'admin1', actorName: '管理者1', targetUserId: 'worker1', itemId: 'wash', recordId: 'new-1',
            detail: { itemName: '洗車', points: 2, status: 'confirmed', source: 'manual' },
        });
    });

    it('自分に付けると確認待ち（status: pending）', async () => {
        mock(prisma.user.findUnique).mockResolvedValue({ id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true });
        const r = await postRecord(body({ userId: 'admin1' }));
        expect(r.status).toBe(201);
        expect(mock(prisma.evaluationPointRecord.createManyAndReturn).mock.calls[0][0].data[0].status).toBe('pending');
        expect(r.body.record).toMatchObject({ status: 'pending', canConfirm: false, canRemove: true });
    });

    it('先の日付は 400「先の日付には付けられません」。何も読まず書かない', async () => {
        const r = await postRecord(body({ date: '2099-01-01' }));
        expect([r.status, r.body.error]).toEqual([400, '先の日付には付けられません']);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        noWrites();
    });

    it('入力の形が違う → 400「入力が不正です」／日付の形 → 400「日付が不正です」', async () => {
        for (const over of [{ userId: 1 }, { itemId: undefined }, { date: 20260930 }, { note: 5 }, { note: 'あ'.repeat(201) }]) {
            const r = await postRecord(body(over));
            expect([JSON.stringify(over), r.status, r.body.details]).toEqual([JSON.stringify(over), 400, '入力が不正です']);
        }
        for (const raw of ['JSON ではない', 'null', '[]']) {
            const r = await postRecord(raw);
            expect([raw, r.status, r.body.details]).toEqual([raw, 400, '入力が不正です']);
        }
        const d = await postRecord(body({ date: '2026-02-30' }));
        expect([d.status, d.body.details]).toEqual([400, '日付が不正です']);
        noWrites();
    });

    it('対象の人: いない・退職 → 400「対象の人が見つかりません」／協力会社のメンバー → 400「評価ポイントの対象外の人です」', async () => {
        mock(prisma.user.findUnique).mockResolvedValueOnce(null);
        expect((await postRecord(body())).body.error).toBe('対象の人が見つかりません');
        mock(prisma.user.findUnique).mockResolvedValueOnce({ id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: false });
        expect((await postRecord(body())).body.error).toBe('対象の人が見つかりません');
        mock(prisma.user.findUnique).mockResolvedValueOnce({ id: 'p1', displayName: '協力', role: 'PARTNER_MEMBER', isActive: true });
        const r = await postRecord(body({ userId: 'p1' }));
        expect([r.status, r.body.error]).toEqual([400, '評価ポイントの対象外の人です']);
        noWrites();
    });

    it('項目: 無い → 404／使わない → 400／点数の行が無い → 400', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValueOnce(null);
        const none = await postRecord(body());
        expect([none.status, none.body.error]).toEqual([404, '項目が見つかりません']);
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValueOnce({ id: 'wash', name: '洗車', isActive: false });
        expect((await postRecord(body())).body.error).toBe('この項目は、今は付けられません');
        mock(prisma.evaluationPointRate.findMany).mockResolvedValueOnce([]);
        expect((await postRecord(body())).body.error).toBe('この項目には点数が設定されていません');
        noWrites();
    });

    it('同じ人・同じ日・同じ項目が既にある → 400。同時に先に入れられて入らなかった → 同じ 400・ログなし', async () => {
        mock(prisma.evaluationPointRecord.findFirst).mockResolvedValueOnce({ id: 'r1' });
        const dup = await postRecord(body());
        expect([dup.status, dup.body.error]).toEqual([400, 'その日のその項目は、すでに付いています']);
        expect(prisma.evaluationPointRecord.createManyAndReturn).not.toHaveBeenCalled();

        mock(prisma.evaluationPointRecord.createManyAndReturn).mockResolvedValueOnce([]);
        const race = await postRecord(body());
        expect([race.status, race.body.error]).toEqual([400, 'その日のその項目は、すでに付いています']);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});

// ================================================================ PATCH

describe('PATCH /records（認める）', () => {
    it('自分の分・すでに確定・無い ID は skipped。認めてよい記録だけ updateMany（status: pending を条件に）・ログは1件1行', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([
            recordRow({ id: 'own', userId: 'admin1', status: 'pending', createdBy: 'admin1' }),
            recordRow({ id: 'done', status: 'confirmed' }),
            recordRow({ id: 'ok', status: 'pending', createdBy: 'worker1' }),
        ]);
        const r = await patchRecords({ action: 'confirm', ids: ['own', 'done', 'ok', 'missing', 'ok'] });
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ confirmed: 1, skipped: 3 });
        expect(prisma.evaluationPointRecord.updateMany).toHaveBeenCalledTimes(1);
        const args = mock(prisma.evaluationPointRecord.updateMany).mock.calls[0][0];
        expect(args.where).toEqual({ id: 'ok', status: 'pending' });
        expect(args.data).toMatchObject({ status: 'confirmed', confirmedBy: 'admin1', confirmedByName: '管理者1' });
        expect(args.data.confirmedAt).toBeInstanceOf(Date);
        const logs = mock(prisma.evaluationPointLog.createMany).mock.calls[0][0].data;
        expect(logs).toEqual([expect.objectContaining({
            action: 'record_confirmed', actorId: 'admin1', targetUserId: 'worker1', itemId: 'wash', recordId: 'ok',
            recordDate: utc0('2026-09-30'), detail: { itemName: '洗車', points: 2 },
        })]);
    });

    it('自分の分だけを送ると、何も変えずに全部 skipped', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([recordRow({ id: 'own', userId: 'admin1', status: 'pending', createdBy: 'admin1' })]);
        const r = await patchRecords({ action: 'confirm', ids: ['own'] });
        expect(r.body).toEqual({ confirmed: 0, skipped: 1 });
        noWrites();
    });

    it('読んだあとで、ほかの人が先に認めた（updateMany の件数 0）→ skipped・ログなし', async () => {
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([recordRow({ id: 'ok', status: 'pending', createdBy: 'worker1' })]);
        mock(prisma.evaluationPointRecord.updateMany).mockResolvedValue({ count: 0 });
        const r = await patchRecords({ action: 'confirm', ids: ['ok'] });
        expect(r.body).toEqual({ confirmed: 0, skipped: 1 });
        expect(prisma.evaluationPointLog.createMany).not.toHaveBeenCalled();
    });

    it('形が違う → 400「入力が不正です」', async () => {
        for (const b of [{ action: 'approve', ids: ['a'] }, { action: 'confirm' }, { action: 'confirm', ids: [1] }, { action: 'confirm', ids: 'a' }]) {
            const r = await patchRecords(b);
            expect([JSON.stringify(b), r.status, r.body.details]).toEqual([JSON.stringify(b), 400, '入力が不正です']);
        }
        noWrites();
    });
});

// ================================================================ DELETE

describe('DELETE /records/[id]', () => {
    it('取り消せない記録（自分の確定済みの分）は 403「この記録は取り消せません」', async () => {
        mock(prisma.evaluationPointRecord.findUnique).mockResolvedValue(recordRow({ userId: 'admin1', status: 'confirmed', createdBy: 'manager1' }));
        const r = await deleteRecord('r1');
        expect([r.status, r.body.error]).toEqual([403, 'この記録は取り消せません']);
        noWrites();
    });

    it('無ければ 404', async () => {
        mock(prisma.evaluationPointRecord.findUnique).mockResolvedValue(null);
        const r = await deleteRecord('nope');
        expect([r.status, r.body.error]).toEqual([404, '記録が見つかりません']);
        noWrites();
    });

    it('消すときは id と読んだときの status を条件に。消えたら写しをログに残す', async () => {
        mock(prisma.evaluationPointRecord.findUnique).mockResolvedValue(recordRow({ status: 'pending', createdBy: 'worker1' }));
        const r = await deleteRecord('r1');
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true });
        expect(mock(prisma.evaluationPointRecord.deleteMany).mock.calls[0][0]).toEqual({ where: { id: 'r1', status: 'pending' } });
        const log = mock(prisma.evaluationPointLog.create).mock.calls[0][0].data;
        expect(log).toMatchObject({ action: 'record_removed', actorId: 'admin1', targetUserId: 'worker1', itemId: 'wash', recordId: 'r1', recordDate: utc0('2026-09-30') });
        expect(log.detail).toMatchObject({ id: 'r1', userId: 'worker1', date: '2026-09-30', itemName: '洗車', points: 2, status: 'pending', createdBy: 'worker1' });
    });

    it('読んだあとで状態が変わっていた（消えた件数 0）→ 400「記録の状態が変わっています…」・ログなし', async () => {
        mock(prisma.evaluationPointRecord.findUnique).mockResolvedValue(recordRow({ status: 'pending', createdBy: 'worker1' }));
        mock(prisma.evaluationPointRecord.deleteMany).mockResolvedValue({ count: 0 });
        const r = await deleteRecord('r1');
        expect([r.status, r.body.error]).toEqual([400, '記録の状態が変わっています。画面を読み直してください']);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});
