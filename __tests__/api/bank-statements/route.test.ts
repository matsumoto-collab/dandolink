/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/bank-statements/route';
import { PATCH, DELETE } from '@/app/api/bank-statements/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { NextRequest } from 'next/server';

const uploadMock = jest.fn().mockResolvedValue({ error: null });
const removeMock = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: {
        storage: {
            from: () => ({
                upload: (...args: unknown[]) => uploadMock(...args),
                remove: (...args: unknown[]) => removeMock(...args),
                createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/s' } }),
            }),
        },
    },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'admin', isActive: true, canAccessCashbook: true } };
const future = new Date(Date.now() + 60 * 60 * 1000);
// 署名URLを有効なまま持たせ、再署名パス（prisma.bankStatement.update）を回避する
const row = {
    id: 'bs1',
    targetMonth: '2026-07',
    memo: null,
    fileName: '入金明細.pdf',
    storagePath: 'bank-statements/bs1.pdf',
    thumbnailPath: null,
    mimeType: 'application/pdf',
    fileSize: 1234,
    signedUrl: 'https://example.test/s',
    signedUrlExpiresAt: future,
    thumbnailSignedUrl: null,
    thumbnailSignedUrlExpiresAt: null,
};

describe('/api/bank-statements GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.bankStatement.findMany as jest.Mock).mockResolvedValue([row]);
    });

    it('returns all statements ordered by targetMonth then createdAt (newest first)', async () => {
        const res = await GET(new NextRequest('http://localhost/api/bank-statements'));
        expect(res.status).toBe(200);
        const arg = (prisma.bankStatement.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({});
        expect(arg.orderBy).toEqual([{ targetMonth: 'desc' }, { createdAt: 'desc' }]);
    });

    it('filters by ?month', async () => {
        await GET(new NextRequest('http://localhost/api/bank-statements?month=2026-07'));
        const arg = (prisma.bankStatement.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ targetMonth: '2026-07' });
    });

    it('400 for a malformed ?month', async () => {
        const res = await GET(new NextRequest('http://localhost/api/bank-statements?month=2026-13'));
        expect(res.status).toBe(400);
        expect(prisma.bankStatement.findMany).not.toHaveBeenCalled();
    });

    it('403 without the cashbook access flag (even for admin)', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        const res = await GET(new NextRequest('http://localhost/api/bank-statements'));
        expect(res.status).toBe(403);
    });
});

describe('/api/bank-statements POST', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.bankStatement.create as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
    });

    const post = (fd: FormData) => POST(new NextRequest('http://localhost/api/bank-statements', { method: 'POST', body: fd }));
    const form = (file: File | null, targetMonth?: string, memo?: string) => {
        const fd = new FormData();
        if (file) fd.append('file', file, file.name);
        if (targetMonth !== undefined) fd.append('targetMonth', targetMonth);
        if (memo !== undefined) fd.append('memo', memo);
        return fd;
    };
    const pdf = () => new File([Buffer.from('%PDF-1.4 test')], '入金明細.pdf', { type: 'application/pdf' });

    it('400 when no file is attached', async () => {
        const res = await post(form(null, '2026-07'));
        expect(res.status).toBe(400);
    });

    it('400 for a malformed targetMonth', async () => {
        expect((await post(form(pdf(), '2026-13'))).status).toBe(400);
        expect((await post(form(pdf()))).status).toBe(400);
    });

    it('400 for an unsupported file type', async () => {
        const res = await post(form(new File([Buffer.from('x')], 'a.docx', { type: 'application/msword' }), '2026-07'));
        expect(res.status).toBe(400);
    });

    it('stores a PDF under the bank-statements/ prefix and returns 201', async () => {
        const res = await post(form(pdf(), '2026-07', ' 三菱UFJ 普通 '));
        expect(res.status).toBe(201);
        const data = (prisma.bankStatement.create as jest.Mock).mock.calls[0][0].data;
        expect(data.storagePath).toMatch(/^bank-statements\//);
        expect(data.mimeType).toBe('application/pdf');
        expect(data.targetMonth).toBe('2026-07');
        expect(data.memo).toBe('三菱UFJ 普通');
        expect(data.uploadedBy).toBe('user-1');
        expect(uploadMock).toHaveBeenCalledWith(data.storagePath, expect.anything(), { contentType: 'application/pdf', upsert: false });
    });

    it('accepts a CSV even when the browser reports a non-csv MIME type (extension fallback)', async () => {
        const res = await post(form(new File([Buffer.from('日付,金額')], 'meisai.csv', { type: 'application/vnd.ms-excel' }), '2026-07'));
        expect(res.status).toBe(201);
        const data = (prisma.bankStatement.create as jest.Mock).mock.calls[0][0].data;
        expect(data.storagePath).toMatch(/^bank-statements\/.+\.csv$/);
        expect(data.mimeType).toBe('text/csv');
    });

    it('403 without the cashbook access flag', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        expect((await post(form(pdf(), '2026-07'))).status).toBe(403);
    });
});

describe('/api/bank-statements/[id]', () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const patchReq = (body: unknown) => new NextRequest('http://localhost/api/bank-statements/bs1', { method: 'PATCH', body: JSON.stringify(body) });

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.bankStatement.findUnique as jest.Mock).mockResolvedValue(row);
        (prisma.bankStatement.update as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
        (prisma.bankStatement.delete as jest.Mock).mockResolvedValue(row);
    });

    it('trims the memo and nulls it when emptied', async () => {
        const res = await PATCH(patchReq({ memo: ' 三菱UFJ ' }), ctx('bs1'));
        expect(res.status).toBe(200);
        expect((prisma.bankStatement.update as jest.Mock).mock.calls[0][0].data.memo).toBe('三菱UFJ');

        await PATCH(patchReq({ memo: '' }), ctx('bs1'));
        expect((prisma.bankStatement.update as jest.Mock).mock.calls[1][0].data.memo).toBeNull();
    });

    it('moves the statement to another month', async () => {
        const res = await PATCH(patchReq({ targetMonth: '2026-06' }), ctx('bs1'));
        expect(res.status).toBe(200);
        expect((prisma.bankStatement.update as jest.Mock).mock.calls[0][0].data.targetMonth).toBe('2026-06');
    });

    it('400 for a malformed targetMonth', async () => {
        const res = await PATCH(patchReq({ targetMonth: '2026-00' }), ctx('bs1'));
        expect(res.status).toBe(400);
        expect(prisma.bankStatement.update).not.toHaveBeenCalled();
    });

    it('400 when no editable field is present', async () => {
        expect((await PATCH(patchReq({ unknown: 1 }), ctx('bs1'))).status).toBe(400);
    });

    it('404 for a missing statement', async () => {
        (prisma.bankStatement.findUnique as jest.Mock).mockResolvedValue(null);
        expect((await PATCH(patchReq({ memo: 'x' }), ctx('bs1'))).status).toBe(404);
    });

    it('DELETE removes the stored file (and its thumbnail) before deleting the row', async () => {
        (prisma.bankStatement.findUnique as jest.Mock).mockResolvedValue({
            ...row,
            storagePath: 'bank-statements/bs1.webp',
            thumbnailPath: 'bank-statements/bs1_thumb.webp',
        });
        const res = await DELETE(new NextRequest('http://localhost/api/bank-statements/bs1', { method: 'DELETE' }), ctx('bs1'));
        expect(res.status).toBe(200);
        expect(removeMock).toHaveBeenCalledWith(['bank-statements/bs1.webp', 'bank-statements/bs1_thumb.webp']);
        expect(prisma.bankStatement.delete).toHaveBeenCalledWith({ where: { id: 'bs1' } });
    });

    it('DELETE 403 without the cashbook access flag', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        const res = await DELETE(new NextRequest('http://localhost/api/bank-statements/bs1', { method: 'DELETE' }), ctx('bs1'));
        expect(res.status).toBe(403);
    });
});
