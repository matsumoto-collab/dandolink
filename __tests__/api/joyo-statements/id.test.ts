/**
 * @jest-environment node
 */
import { Prisma } from '@prisma/client';
import { DELETE } from '@/app/api/joyo-statements/[id]/route';
import { POST as unissue } from '@/app/api/joyo-statements/[id]/unissue/route';
import { prisma } from '@/lib/prisma';
import { asAdmin, asManager, jsonRequest } from './_fixtures';

const params = { params: { id: 's-1' } };
const unissueReq = () => jsonRequest('/api/joyo-statements/s-1/unissue', 'POST');
const deleteReq = () => jsonRequest('/api/joyo-statements/s-1', 'DELETE');

beforeEach(() => {
    jest.clearAllMocks();
    asAdmin();
    (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoStatement.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.joyoStatement.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.paymentSchedule.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('POST /api/joyo-statements/[id]/unissue', () => {
    it('manager は 403', async () => {
        asManager();
        expect((await unissue(unissueReq(), params)).status).toBe(403);
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });

    it('発行済みでなければ 400', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'draft',
            paymentScheduleId: null,
        });
        expect((await unissue(unissueReq(), params)).status).toBe(400);
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });

    it('支払予定の行が支払済みで残っていれば 400（支払済みの文言）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'issued',
            paymentScheduleId: 'ps-1',
        });
        (prisma.paymentSchedule.findUnique as jest.Mock).mockResolvedValue({ id: 'ps-1', isPaid: true });
        const res = await unissue(unissueReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('支払済みのため、発行を取り消せません');
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });

    it('支払予定の行が未払いで残っていれば 400（先に支払予定で消す文言）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'issued',
            paymentScheduleId: 'ps-1',
        });
        (prisma.paymentSchedule.findUnique as jest.Mock).mockResolvedValue({ id: 'ps-1', isPaid: false });
        const res = await unissue(unissueReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('先に『支払予定』でこの行を削除して');
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });

    it('支払予定の行が消えていれば取り消せる（写しを空に・書類番号は残す・paymentScheduleId は null）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'issued',
            paymentScheduleId: 'ps-gone',
        });
        const res = await unissue(unissueReq(), params);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-1' });
        const arg = (prisma.joyoStatement.updateMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ id: 's-1', status: 'issued', paymentScheduleId: 'ps-gone' });
        expect(arg.data).toEqual({
            status: 'draft',
            issuedSnapshot: Prisma.DbNull,
            issuedAt: null,
            issuedBy: null,
            paymentScheduleId: null,
            updatedBy: 'admin-1',
        });
        expect(arg.data).not.toHaveProperty('statementNo');
    });

    it('明細が無ければ 404', async () => {
        expect((await unissue(unissueReq(), params)).status).toBe(404);
    });
});

describe('DELETE /api/joyo-statements/[id]', () => {
    it('manager は 403', async () => {
        asManager();
        expect((await DELETE(deleteReq(), params)).status).toBe(403);
        expect(prisma.joyoStatement.deleteMany).not.toHaveBeenCalled();
    });

    it('発行済みは 400', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'issued',
            statementNo: '202608-01',
        });
        const res = await DELETE(deleteReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('発行済みの明細は消せません');
        expect(prisma.joyoStatement.deleteMany).not.toHaveBeenCalled();
    });

    it('一度発行した下書き（書類番号あり）は 400', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'draft',
            statementNo: '202608-01',
        });
        const res = await DELETE(deleteReq(), params);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('一度発行した明細は消せません');
        expect(prisma.joyoStatement.deleteMany).not.toHaveBeenCalled();
    });

    it('一度も発行していない下書きは消せる', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'draft',
            statementNo: null,
        });
        const res = await DELETE(deleteReq(), params);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-1' });
        expect((prisma.joyoStatement.deleteMany as jest.Mock).mock.calls[0][0].where).toEqual({
            id: 's-1',
            status: 'draft',
            statementNo: null,
        });
    });
});
