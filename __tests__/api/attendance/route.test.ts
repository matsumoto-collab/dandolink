/**
 * @jest-environment node
 *
 * POST /api/attendance（出勤簿の保存）の、備考（note）の扱いのテスト。
 *
 * 「出勤簿入力」は備考を送らない。備考を送らない保存で、すでに入っている備考を消さないことを確かめる。
 * @/lib/prisma は jest.setup.ts がモックに差し替えているので、upsert に渡した引数（update・create）で確かめる。
 */
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/attendance/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

interface UpsertArgs {
    where: { userId_date: { userId: string; date: Date } };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
}

const loginAs = (user: { id: string; role: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, ...user } }, error: null });

const save = async (items: Record<string, unknown>[], foremanId = 'foremanA') => {
    const res = await POST(new NextRequest('http://localhost/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foremanId, date: '2026-09-30', items }),
    }));
    return { status: res.status, upserts: mock(prisma.attendanceRecord.upsert).mock.calls.map((c) => c[0] as UpsertArgs) };
};

/** 「出勤簿入力」が送る1人ぶん（備考・区分は送らない） */
const fromModal = (userId: string, over: Record<string, unknown> = {}) =>
    ({ userId, earlyStartMinutes: 0, morningLoadingMinutes: 30, overtimeMinutes: 0, eveningLoadingMinutes: 0, earlyEndTime: null, ...over });

beforeEach(() => {
    jest.clearAllMocks();
    loginAs({ id: 'foremanA', role: 'foreman2' });
    mock(prisma.attendanceRecord.upsert).mockImplementation(async (args: UpsertArgs) => ({ id: 'rec', ...args.create }));
    // この route は $transaction に「配列」を渡す。共通モックはコールバックの形だけなので、ここで差し替える
    mock(prisma.$transaction).mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe('POST /api/attendance: 備考（note）', () => {
    it('備考を送らない保存（出勤簿入力）では、すでにある記録の備考に触らない。新しく作る記録の備考は null', async () => {
        const { status, upserts } = await save([fromModal('worker1'), fromModal('worker2', { overtimeMinutes: 60 })]);
        expect(status).toBe(200);
        expect(upserts).toHaveLength(2);
        for (const u of upserts) {
            expect(Object.prototype.hasOwnProperty.call(u.update, 'note')).toBe(false);
            expect(u.create.note).toBeNull();
        }
        // 備考のほかは、今までどおり書き換える
        expect(upserts[1].update).toEqual({
            userId: 'worker2', date: new Date('2026-09-30T00:00:00.000Z'), foremanId: 'foremanA',
            earlyStartMinutes: 0, morningLoadingMinutes: 30, overtimeMinutes: 60, eveningLoadingMinutes: 0, earlyEndTime: null,
            createdBy: 'foremanA',
        });
        expect(upserts[1].create).toEqual({ ...upserts[1].update, note: null });
    });

    it('備考を送った保存（月次の画面からの新規）では、今までどおり、その備考で書き換える。null を送ったら空にする', async () => {
        loginAs({ id: 'admin1', role: 'admin' });
        const { upserts } = await save([
            fromModal('worker1', { note: '現場が変更になった' }),
            fromModal('worker2', { note: null }),
            fromModal('worker3', { note: '' }),
        ], 'admin1');
        expect([upserts[0].update.note, upserts[0].create.note]).toEqual(['現場が変更になった', '現場が変更になった']);
        expect(Object.prototype.hasOwnProperty.call(upserts[1].update, 'note')).toBe(true);
        expect([upserts[1].update.note, upserts[1].create.note]).toEqual([null, null]);
        // 空文字は、今までどおりそのまま入る（?? は空文字を null にしない）
        expect([upserts[2].update.note, upserts[2].create.note]).toEqual(['', '']);
    });
});

describe('POST /api/attendance: 今までの動きが変わっていないこと', () => {
    it('区分（status）は、管理者が送ったときだけ入る。職長が送っても入らない', async () => {
        const asForeman = await save([fromModal('worker1', { status: 'paid_leave' })]);
        expect('status' in asForeman.upserts[0].update).toBe(false);
        expect('status' in asForeman.upserts[0].create).toBe(false);

        mock(prisma.attendanceRecord.upsert).mockClear();
        loginAs({ id: 'admin1', role: 'admin' });
        const asAdmin = await save([fromModal('worker1', { status: 'paid_leave', note: null })], 'admin1');
        expect([asAdmin.upserts[0].update.status, asAdmin.upserts[0].create.status]).toEqual(['paid_leave', 'paid_leave']);

        mock(prisma.attendanceRecord.upsert).mockClear();
        const unknownStatus = await save([fromModal('worker1', { status: 'でたらめ' })], 'admin1');
        expect('status' in unknownStatus.upserts[0].update).toBe(false);
    });

    it('職長は、ほかの職長の出勤簿を保存できない（403・何も保存しない）', async () => {
        const { status, upserts } = await save([fromModal('worker1')], 'foremanB');
        expect(status).toBe(403);
        expect(upserts).toHaveLength(0);
    });

    it('同じ人・同じ日で upsert する（日付は UTC 0時の印）', async () => {
        const { upserts } = await save([fromModal('worker1')]);
        expect(upserts[0].where).toEqual({ userId_date: { userId: 'worker1', date: new Date('2026-09-30T00:00:00.000Z') } });
    });
});
