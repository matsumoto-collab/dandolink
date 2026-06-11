/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/safety-documents/route';
import { PUT, DELETE } from '@/app/api/safety-documents/[id]/route';
import { POST as REFRESH } from '@/app/api/safety-documents/[id]/refresh/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        safetyDocument: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        projectMaster: {
            findUnique: jest.fn(),
        },
        worker: {
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: msg, details }, { status: 400 })),
    notFoundResponse: jest.fn().mockImplementation((name) => NextResponse.json({ error: `${name}が見つかりません` }, { status: 404 })),
    deleteSuccessResponse: jest.fn().mockImplementation((name) => NextResponse.json({ message: `${name}を削除しました` })),
}));

const managerSession = { session: { user: { id: 'u-admin', role: 'manager' } }, error: null };
const forbidden = {
    session: null,
    error: NextResponse.json({ error: '権限が必要です' }, { status: 403 }),
};

const header = {
    primeContractor: '元請建設',
    primeSiteManager: '所長A',
    siteName: 'テスト現場',
    tier: '一次',
    submitDate: '2026-06-11',
    companyName: '自社',
    companyRepresentative: '代表',
    companyAddress: '東京都',
};

const dbWorker = (id: string, name: string, furigana: string | null = null) => ({
    id,
    name,
    safetyProfile: furigana
        ? {
              furigana,
              birthDate: new Date('1980-05-01T00:00:00.000Z'),
              gender: null, jobType: null, attributes: [], hireDate: null,
              experienceYears: null, workerCategory: null, address: null, tel: null,
              familyContact: null, familyTel: null, healthCheckDate: null,
              bloodPressure: null, bloodType: null, specialHealthCheckDate: null,
              specialHealthCheckType: null, healthInsurance: null, pensionInsurance: null,
              employmentInsurance: null, employmentInsuranceLast4: null,
              rosaiSpecialInsurance: null, kentaikyo: null, chutaikyo: null,
              kentaikyoTechou: null, ccusId: null, notes: null,
              qualifications: [],
          }
        : null,
});

const jsonReq = (method: string, body: unknown) =>
    new NextRequest('http://localhost:3000/api/safety-documents', {
        method,
        body: JSON.stringify(body),
    });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/safety-documents', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue(managerSession);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    });

    describe('GET（一覧）', () => {
        it('論理削除済みを除外して返す', async () => {
            (prisma.safetyDocument.findMany as jest.Mock).mockResolvedValue([]);
            const res = await GET(new NextRequest('http://localhost:3000/api/safety-documents'));
            expect(res.status).toBe(200);
            const where = (prisma.safetyDocument.findMany as jest.Mock).mock.calls[0][0].where;
            expect(where.deletedAt).toBeNull();
        });

        it('manager 未満は 403', async () => {
            (requireManagerOrAbove as jest.Mock).mockResolvedValue(forbidden);
            const res = await GET(new NextRequest('http://localhost:3000/api/safety-documents'));
            expect(res.status).toBe(403);
        });
    });

    describe('POST（作成 = サーバー側スナップショット生成）', () => {
        it('members から現在のマスター値でスナップショットを生成して保存する', async () => {
            (prisma.worker.findMany as jest.Mock).mockResolvedValue([dbWorker('w1', '山田太郎', 'やまだ')]);
            (prisma.safetyDocument.create as jest.Mock).mockImplementation(async (args) => ({
                id: 'd1',
                ...args.data,
                projectMaster: null,
            }));

            const res = await POST(
                jsonReq('POST', {
                    type: 'sagyoin_meibo',
                    projectId: null,
                    title: 'テスト現場 作業員名簿',
                    header,
                    members: [{ source: 'worker', sourceId: 'w1' }],
                })
            );
            expect(res.status).toBe(201);

            const createArgs = (prisma.safetyDocument.create as jest.Mock).mock.calls[0][0];
            expect(createArgs.data.createdBy).toBe('u-admin');
            expect(createArgs.data.data.header.submitDate).toBe('2026-06-11');
            expect(createArgs.data.data.workers).toHaveLength(1);
            expect(createArgs.data.data.workers[0]).toMatchObject({
                key: 'worker:w1',
                name: '山田太郎',
                profile: expect.objectContaining({ furigana: 'やまだ', birthDate: '1980-05-01' }),
            });
        });

        it('存在しないメンバー参照は 400', async () => {
            (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
            const res = await POST(
                jsonReq('POST', {
                    type: 'sagyoin_meibo',
                    title: 't',
                    header,
                    members: [{ source: 'worker', sourceId: 'missing' }],
                })
            );
            expect(res.status).toBe(400);
            expect(prisma.safetyDocument.create).not.toHaveBeenCalled();
        });

        it('提出日が YYYY-MM-DD でなければ 400（FR-3-7 の基準日保証）', async () => {
            const res = await POST(
                jsonReq('POST', {
                    type: 'sagyoin_meibo',
                    title: 't',
                    header: { ...header, submitDate: '2026/06/11' },
                    members: [],
                })
            );
            expect(res.status).toBe(400);
        });
    });

    describe('PUT [id]（FR-4-2: 既存メンバーのスナップショット据え置き）', () => {
        it('既存メンバーは保存済みスナップショットを保ち、新規のみ現在値で取得する', async () => {
            const savedSnapshot = {
                key: 'worker:w1',
                source: 'worker',
                sourceId: 'w1',
                name: '山田太郎（保存時点）',
                profile: null,
            };
            (prisma.safetyDocument.findFirst as jest.Mock).mockResolvedValue({
                id: 'd1',
                type: 'sagyoin_meibo',
                projectId: null,
                title: 't',
                data: { header, workers: [savedSnapshot] },
                deletedAt: null,
            });
            // マスター側は名前が変わっている + 新メンバー w2 が居る
            (prisma.worker.findMany as jest.Mock).mockResolvedValue([dbWorker('w2', '佐藤次郎')]);
            (prisma.safetyDocument.update as jest.Mock).mockImplementation(async (args) => ({
                id: 'd1',
                ...args.data,
                projectMaster: null,
            }));

            const res = await PUT(
                jsonReq('PUT', {
                    members: [
                        { source: 'worker', sourceId: 'w1' },
                        { source: 'worker', sourceId: 'w2' },
                    ],
                }),
                ctx('d1')
            );
            expect(res.status).toBe(200);

            const workers = (prisma.safetyDocument.update as jest.Mock).mock.calls[0][0].data.data.workers;
            expect(workers).toHaveLength(2);
            // 既存 w1 は据え置き（マスターの最新値で上書きされない）
            expect(workers[0].name).toBe('山田太郎（保存時点）');
            // 新規 w2 は現在値から
            expect(workers[1]).toMatchObject({ key: 'worker:w2', name: '佐藤次郎' });
            // 既存メンバーぶんの DB 取得は新規分のみ（w2 のみ in 句に入る）
            const findManyWhere = (prisma.worker.findMany as jest.Mock).mock.calls[0][0].where;
            expect(findManyWhere.id.in).toEqual(['w2']);
        });

        it('削除済み書類は 404', async () => {
            (prisma.safetyDocument.findFirst as jest.Mock).mockResolvedValue(null);
            const res = await PUT(jsonReq('PUT', { title: 'x' }), ctx('d1'));
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE [id]（FR-2-5: 論理削除のみ）', () => {
        it('deletedAt をセットする（物理削除しない）', async () => {
            (prisma.safetyDocument.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            const res = await DELETE(new NextRequest('http://localhost:3000/api/safety-documents/d1'), ctx('d1'));
            expect(res.status).toBe(200);

            const args = (prisma.safetyDocument.updateMany as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ id: 'd1', deletedAt: null });
            expect(args.data.deletedAt).toBeInstanceOf(Date);
        });

        it('対象なし（既に削除済み含む）は 404', async () => {
            (prisma.safetyDocument.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
            const res = await DELETE(new NextRequest('http://localhost:3000/api/safety-documents/d1'), ctx('d1'));
            expect(res.status).toBe(404);
        });
    });

    describe('POST [id]/refresh（FR-4-3: 最新値で更新）', () => {
        it('取得できた対象は最新化し、消えた対象は据え置いて notFoundKeys で知らせる', async () => {
            (prisma.safetyDocument.findFirst as jest.Mock).mockResolvedValue({
                id: 'd1',
                data: {
                    header,
                    workers: [
                        { key: 'worker:w1', source: 'worker', sourceId: 'w1', name: '旧名', profile: null },
                        { key: 'worker:gone', source: 'worker', sourceId: 'gone', name: '退職者', profile: null },
                    ],
                },
                deletedAt: null,
            });
            (prisma.worker.findMany as jest.Mock).mockResolvedValue([dbWorker('w1', '新名', 'しんめい')]);
            (prisma.safetyDocument.update as jest.Mock).mockImplementation(async (args) => ({
                id: 'd1',
                ...args.data,
                projectMaster: null,
            }));

            const res = await REFRESH(new NextRequest('http://localhost:3000/api/safety-documents/d1/refresh'), ctx('d1'));
            expect(res.status).toBe(200);
            const body = await res.json();

            expect(body.notFoundKeys).toEqual(['worker:gone']);
            const workers = (prisma.safetyDocument.update as jest.Mock).mock.calls[0][0].data.data.workers;
            expect(workers[0].name).toBe('新名');
            expect(workers[0].profile.furigana).toBe('しんめい');
            expect(workers[1].name).toBe('退職者'); // 据え置き
        });
    });
});
