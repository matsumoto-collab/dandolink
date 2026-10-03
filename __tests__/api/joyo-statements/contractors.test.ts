/**
 * @jest-environment node
 */
import { GET as listContractors, POST as createContractor } from '@/app/api/joyo-statements/contractors/route';
import { PATCH as updateContractor } from '@/app/api/joyo-statements/contractors/[id]/route';
import { PUT as saveSettings } from '@/app/api/joyo-statements/settings/route';
import { prisma } from '@/lib/prisma';
import type { JoyoContractorsResponse } from '@/types/joyoStatement';
import { asAdmin, asManager, contractorRow, jsonRequest } from './_fixtures';

const createBody = (overrides: Record<string, unknown> = {}) => ({
    userId: 'u-9',
    recipientName: ' 田中工業 ',
    honorific: '御中',
    postalCode: '〒790-0001',
    address: '愛媛県松山市',
    registrationNumber: 'Ｔ１２３４５６７８９０１２３',
    unitPrice: 18000,
    payeeId: null,
    notes: '',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    asAdmin();
    (prisma.joyoContractor.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoContractor.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.joyoContractor.create as jest.Mock).mockResolvedValue({ id: 'c-new' });
    (prisma.joyoContractor.update as jest.Mock).mockResolvedValue({ id: 'c-1' });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u-9' });
    (prisma.payee.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payee.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoStatementSettings.upsert as jest.Mock).mockResolvedValue({ id: 'default' });
});

describe('GET /api/joyo-statements/contractors', () => {
    it('manager は 403', async () => {
        asManager();
        expect((await listContractors()).status).toBe(403);
    });

    it('選べるユーザーは 対象ロール・利用中・未登録 を dispatchSortOrder → 名前の順。振込先は口座番号を返さない', async () => {
        (prisma.joyoContractor.findMany as jest.Mock).mockResolvedValue([contractorRow({ payeeId: 'p-1' })]);
        (prisma.user.findMany as jest.Mock).mockImplementation((args: { where: Record<string, unknown> }) => {
            // 対象者の名前を引く呼び出し（id で絞る）
            if (args.where.id) return Promise.resolve([{ id: 'u-1', displayName: '山田 太郎' }]);
            // 選択肢の呼び出し（isActive で絞る）
            return Promise.resolve([
                { id: 'u-1', displayName: '山田 太郎', role: 'foreman1', dispatchSortOrder: 1 }, // 登録済み
                { id: 'u-2', displayName: 'い', role: 'WORKER', dispatchSortOrder: null },
                { id: 'u-3', displayName: 'あ', role: 'worker', dispatchSortOrder: null },
                { id: 'u-4', displayName: 'う', role: 'Foreman2', dispatchSortOrder: 5 },
                { id: 'u-5', displayName: '協力', role: 'PARTNER', dispatchSortOrder: 0 },
                { id: 'u-6', displayName: '税理士', role: 'accountant', dispatchSortOrder: 0 },
            ]);
        });
        (prisma.payee.findMany as jest.Mock).mockImplementation((args: { where: Record<string, unknown> }) => {
            const p1 = {
                id: 'p-1',
                name: '山田工業',
                bankName: '愛媛銀行',
                branchName: '本店',
                accountNumber: '1234567',
                accountHolder: 'ﾔﾏﾀﾞ',
                isActive: true,
            };
            const p2 = {
                id: 'p-2',
                name: '口座なし',
                bankName: null,
                branchName: null,
                accountNumber: null,
                accountHolder: null,
                isActive: true,
            };
            return Promise.resolve(args.where.id ? [p1] : [p1, p2]);
        });

        const res = await listContractors();
        expect(res.status).toBe(200);
        const body = (await res.json()) as JoyoContractorsResponse;

        expect(body.userOptions).toEqual([
            { id: 'u-4', displayName: 'う' },
            { id: 'u-3', displayName: 'あ' },
            { id: 'u-2', displayName: 'い' },
        ]);
        expect(body.payeeOptions).toEqual([
            { id: 'p-1', name: '山田工業', bankLabel: '愛媛銀行 本店', hasAccount: true },
            { id: 'p-2', name: '口座なし', bankLabel: '', hasAccount: false },
        ]);
        expect(body.contractors).toHaveLength(1);
        expect(body.contractors[0].userDisplayName).toBe('山田 太郎');
        expect(body.contractors[0].payee).toEqual({
            id: 'p-1',
            name: '山田工業',
            bankLabel: '愛媛銀行 本店',
            hasAccount: true,
            isActive: true,
        });
        // 口座番号・名義はどこにも出さない
        const text = JSON.stringify(body);
        expect(text).not.toContain('1234567');
        expect(text).not.toContain('ﾔﾏﾀﾞ');
    });
});

describe('POST /api/joyo-statements/contractors', () => {
    it('manager は 403', async () => {
        asManager();
        expect((await createContractor(jsonRequest('/api/joyo-statements/contractors', 'POST', createBody()))).status).toBe(
            403,
        );
        expect(prisma.joyoContractor.create).not.toHaveBeenCalled();
    });

    it('code＝今の最大＋1・郵便番号の「〒」を落とす・登録番号は全角を半角にして検証', async () => {
        (prisma.joyoContractor.findFirst as jest.Mock).mockResolvedValue({ code: 2 });
        const res = await createContractor(jsonRequest('/api/joyo-statements/contractors', 'POST', createBody()));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'c-new' });
        const data = (prisma.joyoContractor.create as jest.Mock).mock.calls[0][0].data;
        expect(data).toEqual({
            userId: 'u-9',
            code: 3,
            sortOrder: 3,
            recipientName: '田中工業',
            honorific: '御中',
            postalCode: '790-0001',
            address: '愛媛県松山市',
            registrationNumber: 'T1234567890123',
            unitPrice: 18000,
            payeeId: null,
            notes: null,
            updatedBy: 'admin-1',
        });
    });

    it('登録番号の形が違えば 400', async () => {
        const res = await createContractor(
            jsonRequest('/api/joyo-statements/contractors', 'POST', createBody({ registrationNumber: 'T123' })),
        );
        expect(res.status).toBe(400);
        expect(prisma.joyoContractor.create).not.toHaveBeenCalled();
    });

    it('同じユーザーが登録済みなら 400', async () => {
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        const res = await createContractor(jsonRequest('/api/joyo-statements/contractors', 'POST', createBody()));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('このユーザーは登録済みです');
        expect(prisma.joyoContractor.create).not.toHaveBeenCalled();
    });

    it('ユーザー・振込先が無ければ 400', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
        expect(
            (await createContractor(jsonRequest('/api/joyo-statements/contractors', 'POST', createBody()))).status,
        ).toBe(400);
        expect(
            (
                await createContractor(
                    jsonRequest('/api/joyo-statements/contractors', 'POST', createBody({ payeeId: 'p-x' })),
                )
            ).status,
        ).toBe(400);
        expect(prisma.joyoContractor.create).not.toHaveBeenCalled();
    });

    it('code がぶつかったら（P2002）最初から1回だけやり直す', async () => {
        (prisma.joyoContractor.findFirst as jest.Mock).mockResolvedValueOnce({ code: 1 }).mockResolvedValueOnce({ code: 2 });
        (prisma.joyoContractor.create as jest.Mock)
            .mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
            .mockResolvedValueOnce({ id: 'c-retry' });
        const res = await createContractor(jsonRequest('/api/joyo-statements/contractors', 'POST', createBody()));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'c-retry' });
        expect(prisma.joyoContractor.create).toHaveBeenCalledTimes(2);
        expect((prisma.joyoContractor.create as jest.Mock).mock.calls[1][0].data.code).toBe(3);
    });
});

describe('PATCH /api/joyo-statements/contractors/[id]', () => {
    const params = { params: { id: 'c-1' } };

    it('manager は 403', async () => {
        asManager();
        const res = await updateContractor(
            jsonRequest('/api/joyo-statements/contractors/c-1', 'PATCH', { unitPrice: 1 }),
            params,
        );
        expect(res.status).toBe(403);
        expect(prisma.joyoContractor.update).not.toHaveBeenCalled();
    });

    it('送った項目だけ変える（userId は受け取らない）', async () => {
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        const res = await updateContractor(
            jsonRequest('/api/joyo-statements/contractors/c-1', 'PATCH', {
                userId: 'u-other',
                unitPrice: 21000,
                isActive: false,
                address: '',
            }),
            params,
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'c-1' });
        expect((prisma.joyoContractor.update as jest.Mock).mock.calls[0][0]).toEqual({
            where: { id: 'c-1' },
            data: { unitPrice: 21000, isActive: false, address: null, updatedBy: 'admin-1' },
        });
    });

    it('対象者が無ければ 404・振込先が無ければ 400', async () => {
        expect(
            (await updateContractor(jsonRequest('/api/joyo-statements/contractors/c-1', 'PATCH', {}), params)).status,
        ).toBe(404);
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        expect(
            (
                await updateContractor(
                    jsonRequest('/api/joyo-statements/contractors/c-1', 'PATCH', { payeeId: 'p-x' }),
                    params,
                )
            ).status,
        ).toBe(400);
        expect(prisma.joyoContractor.update).not.toHaveBeenCalled();
    });
});

describe('PUT /api/joyo-statements/settings', () => {
    it('manager は 403', async () => {
        asManager();
        const res = await saveSettings(
            jsonRequest('/api/joyo-statements/settings', 'PUT', { title: '支払明細書', footerNote: '' }),
        );
        expect(res.status).toBe(403);
        expect(prisma.joyoStatementSettings.upsert).not.toHaveBeenCalled();
    });

    it("id='default' に upsert する", async () => {
        const res = await saveSettings(
            jsonRequest('/api/joyo-statements/settings', 'PUT', { title: ' 常用明細 ', footerNote: '1行目\r\n2行目' }),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 'default' });
        const arg = (prisma.joyoStatementSettings.upsert as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ id: 'default' });
        expect(arg.create).toEqual({ id: 'default', title: '常用明細', footerNote: '1行目\n2行目', updatedBy: 'admin-1' });
    });

    it('注意書きが5行以上・名前が空なら 400', async () => {
        expect(
            (
                await saveSettings(
                    jsonRequest('/api/joyo-statements/settings', 'PUT', { title: 'a', footerNote: '1\n2\n3\n4\n5' }),
                )
            ).status,
        ).toBe(400);
        expect(
            (await saveSettings(jsonRequest('/api/joyo-statements/settings', 'PUT', { title: '  ', footerNote: '' })))
                .status,
        ).toBe(400);
        expect(prisma.joyoStatementSettings.upsert).not.toHaveBeenCalled();
    });
});
