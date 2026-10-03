/**
 * @jest-environment node
 */
import { POST as addToSchedule } from '@/app/api/joyo-statements/[id]/add-to-schedule/route';
import { prisma } from '@/lib/prisma';
import { asAdmin, asManager, jsonRequest, statementRow } from './_fixtures';

const params = { params: { id: 's-1' } };
const addReq = (body: unknown = { createNewList: false, targetListKey: 'list-1' }) =>
    jsonRequest('/api/joyo-statements/s-1/add-to-schedule', 'POST', body);

const payeeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'p-1',
    name: '山田工業',
    feeBearer: 'us',
    bankName: '愛媛銀行',
    branchName: '本店',
    accountType: '普通',
    accountNumber: '1234567',
    accountHolder: 'ﾔﾏﾀﾞｺｳｷﾞｮｳ',
    isActive: true,
    ...overrides,
});

const issued = (overrides: Record<string, unknown> = {}) =>
    statementRow({ status: 'issued', statementNo: '202608-01', total: 440000, ...overrides });

beforeEach(() => {
    jest.clearAllMocks();
    asAdmin();
    (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(issued());
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ payeeId: 'p-1' });
    (prisma.payee.findUnique as jest.Mock).mockResolvedValue(payeeRow());
    (prisma.paymentSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.paymentSchedule.create as jest.Mock).mockResolvedValue({ id: 'ps-new' });
    (prisma.joyoStatement.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
});

describe('POST /api/joyo-statements/[id]/add-to-schedule', () => {
    it('manager は 403', async () => {
        asManager();
        expect((await addToSchedule(addReq(), params)).status).toBe(403);
        expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
    });

    it('成功時: 振込・明細の合計・支払日・Payee の口座・備考で1行作り、明細に紐付ける', async () => {
        const res = await addToSchedule(addReq(), params);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-1' });

        expect((prisma.paymentSchedule.create as jest.Mock).mock.calls[0][0].data).toEqual({
            paymentDate: new Date('2026-09-10T00:00:00.000Z'),
            paymentType: 'transfer',
            payeeId: 'p-1',
            payeeName: '山田工業',
            amount: 440000,
            feeFlag: true,
            bankName: '愛媛銀行',
            branchName: '本店',
            accountType: '普通',
            accountNumber: '1234567',
            accountHolder: 'ﾔﾏﾀﾞｺｳｷﾞｮｳ',
            listKey: 'list-1',
            notes: '支払明細書より作成（2026年8月分）',
            updatedBy: 'admin-1',
        });
        expect((prisma.joyoStatement.updateMany as jest.Mock).mock.calls[0][0]).toEqual({
            where: { id: 's-1', paymentScheduleId: null },
            data: { paymentScheduleId: 'ps-new' },
        });
        // 振込先マスターの行は作らない
        expect(prisma.payee.create).not.toHaveBeenCalled();
    });

    it('新しいリストなら listKey を新しく発行する・先方負担なら feeFlag は false', async () => {
        (prisma.payee.findUnique as jest.Mock).mockResolvedValue(payeeRow({ feeBearer: 'them' }));
        const res = await addToSchedule(addReq({ createNewList: true, targetListKey: 'list-1' }), params);
        expect(res.status).toBe(200);
        const data = (prisma.paymentSchedule.create as jest.Mock).mock.calls[0][0].data;
        expect(typeof data.listKey).toBe('string');
        expect(data.listKey).not.toBe('list-1');
        expect(data.feeFlag).toBe(false);
    });

    it('支払予定の行が消されていれば（古い ID だけ残っている）追加でき、その古い ID を条件に紐付け直す', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(issued({ paymentScheduleId: 'ps-gone' }));
        const res = await addToSchedule(addReq(), params);
        expect(res.status).toBe(200);
        expect((prisma.joyoStatement.updateMany as jest.Mock).mock.calls[0][0].where).toEqual({
            id: 's-1',
            paymentScheduleId: 'ps-gone',
        });
    });

    it('発行済みでなければ 400', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(statementRow());
        const res = await addToSchedule(addReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('発行済みにしてから追加してください');
        expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
    });

    it('振込先なし・振込先が見つからない・利用停止は 400', async () => {
        const cases: Array<() => void> = [
            () => (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ payeeId: null }),
            () => (prisma.payee.findUnique as jest.Mock).mockResolvedValue(null),
            () => (prisma.payee.findUnique as jest.Mock).mockResolvedValue(payeeRow({ isActive: false })),
        ];
        for (const setup of cases) {
            (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ payeeId: 'p-1' });
            (prisma.payee.findUnique as jest.Mock).mockResolvedValue(payeeRow());
            setup();
            const res = await addToSchedule(addReq(), params);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain('振込先が登録されていません（または利用停止です）');
        }
        expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
    });

    it('二重追加（先の行が残っている）は 400', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(issued({ paymentScheduleId: 'ps-1' }));
        (prisma.paymentSchedule.findUnique as jest.Mock).mockResolvedValue({ id: 'ps-1' });
        const res = await addToSchedule(addReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('既に支払予定に追加済みです');
        expect(prisma.paymentSchedule.create).not.toHaveBeenCalled();
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });

    it('同時に追加されて紐付けが 1 件にならなければ 400（トランザクションごと取り消し）', async () => {
        (prisma.joyoStatement.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
        const res = await addToSchedule(addReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('既に支払予定に追加済みです');
    });

    it('追加先のリストの値が不正なら 400', async () => {
        const res = await addToSchedule(addReq({ targetListKey: 123 }), params);
        expect(res.status).toBe(400);
        expect(prisma.joyoStatement.findUnique).not.toHaveBeenCalled();
    });

    it('明細が無ければ 404', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(null);
        expect((await addToSchedule(addReq(), params)).status).toBe(404);
    });
});
