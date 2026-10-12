/**
 * @jest-environment node
 */
/**
 * /api/road-permits（一覧・新規作成）の配線のテスト。
 * 既定値の組み立ての中身は __tests__/lib/roadPermitDefaults.test.ts で見ている。ここは
 * 権限・検証・DB の読み書きと、自社情報・案件・コピー元が正しく既定値に渡っているかを見る。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/road-permits/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { buildDefaultRoadPermitDocuments, buildDefaultRoadPermitValues } from '@/lib/roadPermit/defaults';

const getReq = (qs = '') => new NextRequest(`http://localhost/api/road-permits${qs ? `?${qs}` : ''}`);
const postReq = (body: unknown) =>
    new NextRequest('http://localhost/api/road-permits', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

const companyRow = {
    postalCode: '790-0001',
    address: '愛媛県松山市一番町1-1-1',
    name: '株式会社テスト足場',
    representativeTitle: null,
    representative: '山田　太郎',
    tel: '089-000-0000',
    contactPerson: '鈴木',
};

/** 予定日は JST 0 時（= UTC 前日 15 時）で入っている */
const projectRow = {
    id: 'pm1',
    title: '北井門様邸 足場工事',
    location: '松山市北井門1丁目1-1',
    prefecture: '愛媛県',
    city: '松山市',
    scheduledStartDate: new Date('2026-09-04T15:00:00.000Z'),
    scheduledEndDate: new Date('2026-10-03T15:00:00.000Z'),
};

const permitRow = (over: Record<string, unknown> = {}) => {
    const documents = buildDefaultRoadPermitDocuments(['police-road-use', 'matsuyama-occupancy-apply']);
    documents.forms[0].expiryDate = '2026-10-04';
    documents.forms[1].expiryDate = '2026-10-10';
    return {
        id: 'rp1',
        projectMasterId: 'pm1',
        title: '北井門様邸 足場工事',
        status: 'submitted',
        values: buildDefaultRoadPermitValues({
            company: null,
            project: { ...projectRow, scheduledStartDate: '2026-09-05', scheduledEndDate: '2026-10-04' },
            previous: null,
        }),
        documents,
        drawing: null,
        sketchFileId: null,
        createdBy: 'u1',
        updatedBy: 'u1',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        deletedAt: null,
        projectMaster: { title: '北井門様邸 足場工事' },
        ...over,
    };
};

describe('/api/road-permits', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u1', role: 'manager' } }, error: null });
        (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(companyRow);
        (prisma.roadPermit.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.roadPermit.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(projectRow);
        (prisma.roadPermit.create as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'new1',
            drawing: null,
            sketchFileId: null,
            createdAt: new Date('2026-10-12T00:00:00.000Z'),
            updatedAt: new Date('2026-10-12T00:00:00.000Z'),
            deletedAt: null,
            projectMaster: { title: projectRow.title },
            ...data,
        }));
    });

    describe('GET', () => {
        it('権限が無ければそのエラーを返し、DB は読まない', async () => {
            const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

            const res = await GET(getReq());
            expect(res.status).toBe(403);
            expect(prisma.roadPermit.findMany).not.toHaveBeenCalled();
        });

        it('一覧の行（申請先・期間・許可期限）と自社情報・前回の値を返す', async () => {
            (prisma.roadPermit.findMany as jest.Mock).mockResolvedValue([permitRow()]);
            const prev = permitRow().values;
            (prisma.roadPermit.findFirst as jest.Mock).mockResolvedValue({ values: prev });

            const res = await GET(getReq());
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            expect(json.permits).toEqual([
                {
                    id: 'rp1',
                    projectMasterId: 'pm1',
                    projectTitle: '北井門様邸 足場工事',
                    title: '北井門様邸 足場工事',
                    status: 'submitted',
                    authorities: ['松山東署', '松山市'],
                    useFrom: '2026-09-05',
                    useTo: '2026-10-04',
                    expiryDate: '2026-10-10',
                    createdAt: '2026-09-01T00:00:00.000Z',
                    updatedAt: '2026-09-02T00:00:00.000Z',
                },
            ]);
            // null の列は '' にそろえる
            expect(json.company).toEqual({ ...companyRow, representativeTitle: '' });
            expect(json.previous).toEqual(prev);

            // 消したものは出さない・更新が新しい順
            const args = (prisma.roadPermit.findMany as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ deletedAt: null });
            expect(args.orderBy).toEqual({ updatedAt: 'desc' });
            // 前回は消していないもののうち作成が新しいもの
            expect((prisma.roadPermit.findFirst as jest.Mock).mock.calls[0][0]).toMatchObject({
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
        });

        it('status・projectMasterId で絞り込む。自社情報・前回が無ければ null', async () => {
            (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(null);
            const res = await GET(getReq('status=draft&projectMasterId=pm1'));
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json).toEqual({ permits: [], company: null, previous: null });
            expect((prisma.roadPermit.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
                deletedAt: null,
                status: 'draft',
                projectMasterId: 'pm1',
            });
        });

        it('知らない状態での絞り込みは 400', async () => {
            const res = await GET(getReq('status=unknown'));
            expect(res.status).toBe(400);
            expect(prisma.roadPermit.findMany).not.toHaveBeenCalled();
        });
    });

    describe('POST', () => {
        it('権限が無ければそのエラーを返し、作らない', async () => {
            const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

            const res = await POST(postReq({ projectMasterId: 'pm1' }));
            expect(res.status).toBe(403);
            expect(prisma.roadPermit.create).not.toHaveBeenCalled();
        });

        it('案件が選ばれていなければ 400', async () => {
            const res = await POST(postReq({ projectMasterId: '' }));
            expect(res.status).toBe(400);
            expect(prisma.roadPermit.create).not.toHaveBeenCalled();
        });

        it('案件が無ければ 404', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await POST(postReq({ projectMasterId: 'nope' }));
            expect(res.status).toBe(404);
            expect(prisma.roadPermit.create).not.toHaveBeenCalled();
        });

        it('新規作成: 申請者は自社情報、現場・期間（JST の日付）は案件から入れて 201 で返す', async () => {
            const res = await POST(postReq({ projectMasterId: 'pm1' }));
            const json = await res.json();
            expect(res.status).toBe(201);

            const { data } = (prisma.roadPermit.create as jest.Mock).mock.calls[0][0];
            expect(data).toMatchObject({
                projectMasterId: 'pm1',
                title: '北井門様邸 足場工事',
                status: 'draft',
                createdBy: 'u1',
                updatedBy: 'u1',
            });
            expect(data.values.applicant).toMatchObject({ companyName: '株式会社テスト足場', representativeName: '山田　太郎', representativeTitle: '' });
            expect(data.values.contact).toEqual({ name: '鈴木', phone: '' });
            expect(data.values.site).toEqual({ location: '松山市北井門1丁目1-1', projectName: '北井門様邸 足場工事' });
            expect(data.values.period).toMatchObject({ useFrom: '2026-09-05', useTo: '2026-10-04', workFrom: '2026-09-05' });
            expect(data.documents.forms.every((f: { enabled: boolean }) => f.enabled)).toBe(true);

            expect(json).toMatchObject({ id: 'new1', projectTitle: '北井門様邸 足場工事', status: 'draft' });
            expect(json.values.period.useFrom).toBe('2026-09-05');
        });

        it('新規作成: 前回の申請があれば担当者を引き継ぐ', async () => {
            const prev = permitRow().values;
            prev.contact = { name: '前回の担当', phone: '090-1111-2222' };
            (prisma.roadPermit.findFirst as jest.Mock).mockResolvedValue({ values: prev });

            await POST(postReq({ projectMasterId: 'pm1' }));
            const { data } = (prisma.roadPermit.create as jest.Mock).mock.calls[0][0];
            expect(data.values.contact).toEqual({ name: '前回の担当', phone: '090-1111-2222' });
        });

        it('fromId のコピー: コピー元の値が写り、違う案件なら期間は案件から・申請日は空', async () => {
            const src = permitRow({ projectMasterId: 'other-pm' });
            src.values.police.method = '歩道上に足場を設置';
            src.values.police.applicationDate = '2026-08-01';
            src.values.period = { ...src.values.period, useFrom: '2026-01-01', useTo: '2026-01-31' };
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(src);

            const res = await POST(postReq({ projectMasterId: 'pm1', fromId: 'rp1' }));
            expect(res.status).toBe(201);

            const { data } = (prisma.roadPermit.create as jest.Mock).mock.calls[0][0];
            expect(data.values.police.method).toBe('歩道上に足場を設置');
            expect(data.values.police.applicationDate).toBe('');
            expect(data.values.period).toMatchObject({ useFrom: '2026-09-05', useTo: '2026-10-04' });
            // 出す様式の選択だけ写し、許可期限などは空
            expect(data.documents.forms.map((f: { enabled: boolean }) => f.enabled)).toEqual([true, true, false]);
            expect(data.documents.forms[0].expiryDate).toBe('');
            // コピーのときは自社情報・前回は読まない
            expect(prisma.companyInfo.findFirst).not.toHaveBeenCalled();
        });

        it('fromId のコピー: 同じ案件なら期間もコピー元のまま', async () => {
            const src = permitRow();
            src.values.period = { ...src.values.period, useFrom: '2026-01-01', useTo: '2026-01-31' };
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(src);

            await POST(postReq({ projectMasterId: 'pm1', fromId: 'rp1' }));
            const { data } = (prisma.roadPermit.create as jest.Mock).mock.calls[0][0];
            expect(data.values.period).toMatchObject({ useFrom: '2026-01-01', useTo: '2026-01-31' });
        });

        it('コピー元が消してあれば 404', async () => {
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(permitRow({ deletedAt: new Date() }));
            const res = await POST(postReq({ projectMasterId: 'pm1', fromId: 'rp1' }));
            expect(res.status).toBe(404);
            expect(prisma.roadPermit.create).not.toHaveBeenCalled();
        });
    });
});
