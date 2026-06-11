/**
 * @jest-environment node
 */
import { GET, PUT } from '@/app/api/safety-profiles/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        worker: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
        },
        workerSafetyProfile: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: msg, details }, { status: 400 })),
    notFoundResponse: jest.fn().mockImplementation((name) => NextResponse.json({ error: `${name}が見つかりません` }, { status: 404 })),
}));

const managerSession = { session: { user: { id: 'u-admin', role: 'admin' } }, error: null };
const forbidden = {
    session: null,
    error: NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 }),
};

const url = (qs = '') => new NextRequest(`http://localhost:3000/api/safety-profiles${qs}`);
const putReq = (qs: string, body: unknown) =>
    new NextRequest(`http://localhost:3000/api/safety-profiles${qs}`, {
        method: 'PUT',
        body: JSON.stringify(body),
    });

describe('/api/safety-profiles', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue(managerSession);
    });

    describe('GET（統合一覧）', () => {
        it('Worker と User（PARTNER 含む）を統合して返す', async () => {
            (prisma.worker.findMany as jest.Mock).mockResolvedValue([
                { id: 'w1', name: '応援職人', safetyProfile: null },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'u1', displayName: '自社社員A', role: 'foreman1', companyId: null, company: null, safetyProfile: null },
                { id: 'u2', displayName: '協力会社B員', role: 'PARTNER', companyId: 'c1', company: { displayName: '協力会社B' }, safetyProfile: null },
            ]);

            const res = await GET(url());
            expect(res.status).toBe(200);
            const body = await res.json();

            expect(body).toHaveLength(3);
            expect(body[0]).toMatchObject({ key: 'user:u1', source: 'user', name: '自社社員A', role: 'foreman1' });
            expect(body[1]).toMatchObject({ key: 'user:u2', role: 'PARTNER', companyName: '協力会社B' });
            expect(body[2]).toMatchObject({ key: 'worker:w1', source: 'worker', name: '応援職人', role: null });
        });

        it('?workerId= 指定で単体取得（未登録は null）', async () => {
            (prisma.workerSafetyProfile.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await GET(url('?workerId=w1'));
            expect(res.status).toBe(200);
            expect(await res.json()).toBeNull();
            expect(prisma.workerSafetyProfile.findUnique).toHaveBeenCalledWith(
                expect.objectContaining({ where: { workerId: 'w1' } })
            );
        });

        it('workerId と userId の同時指定は 400', async () => {
            const res = await GET(url('?workerId=w1&userId=u1'));
            expect(res.status).toBe(400);
        });

        it('manager 未満は 403（要件§8 / 受け入れ基準5）', async () => {
            (requireManagerOrAbove as jest.Mock).mockResolvedValue(forbidden);
            const res = await GET(url());
            expect(res.status).toBe(403);
            expect(prisma.worker.findMany).not.toHaveBeenCalled();
        });
    });

    describe('PUT（upsert）', () => {
        beforeEach(() => {
            (prisma.worker.findUnique as jest.Mock).mockResolvedValue({ id: 'w1' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
            (prisma.workerSafetyProfile.upsert as jest.Mock).mockImplementation(async (args) => ({
                id: 'p1',
                ...args.create,
                qualifications: [],
            }));
        });

        it('workerId 指定で upsert する（日付は Date に変換）', async () => {
            const res = await PUT(putReq('?workerId=w1', { furigana: 'やまだ', birthDate: '1980-05-01' }));
            expect(res.status).toBe(200);

            const args = (prisma.workerSafetyProfile.upsert as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ workerId: 'w1' });
            expect(args.create.workerId).toBe('w1');
            expect(args.create.userId).toBeUndefined();
            expect(args.create.birthDate).toBeInstanceOf(Date);
            expect(args.update.furigana).toBe('やまだ');
        });

        it('userId 指定で upsert する', async () => {
            const res = await PUT(putReq('?userId=u1', { jobType: 'とび・足場' }));
            expect(res.status).toBe(200);
            const args = (prisma.workerSafetyProfile.upsert as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ userId: 'u1' });
        });

        it('対象未指定は 400', async () => {
            const res = await PUT(putReq('', { furigana: 'x' }));
            expect(res.status).toBe(400);
        });

        it('存在しない対象は 404', async () => {
            (prisma.worker.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await PUT(putReq('?workerId=missing', {}));
            expect(res.status).toBe(404);
        });

        it('雇用保険番号は下4桁以外を 400 で弾く（FR-3-4 / §7.4）', async () => {
            const res = await PUT(putReq('?workerId=w1', { employmentInsuranceLast4: '123456789' }));
            expect(res.status).toBe(400);
            expect(prisma.workerSafetyProfile.upsert).not.toHaveBeenCalled();
        });

        it('未知キー（健康保険番号など禁止項目の混入）は strict で 400（受け入れ基準6）', async () => {
            const res = await PUT(putReq('?workerId=w1', { healthInsuranceNumber: '12-3456' }));
            expect(res.status).toBe(400);
            expect(prisma.workerSafetyProfile.upsert).not.toHaveBeenCalled();
        });

        it('空文字は null に正規化される（クリア動作）', async () => {
            await PUT(putReq('?workerId=w1', { furigana: '' }));
            const args = (prisma.workerSafetyProfile.upsert as jest.Mock).mock.calls[0][0];
            expect(args.update.furigana).toBeNull();
        });
    });
});
