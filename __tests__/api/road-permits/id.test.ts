/**
 * @jest-environment node
 */
/**
 * /api/road-permits/[id]（1 件の取得・保存・論理削除）の配線のテスト。
 */
import { NextRequest, NextResponse } from 'next/server';
import { DELETE, GET, PUT } from '@/app/api/road-permits/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { buildDefaultRoadPermitDocuments, buildDefaultRoadPermitValues } from '@/lib/roadPermit/defaults';

const ctx = { params: { id: 'rp1' } };
const req = (method: string, body?: unknown) =>
    new NextRequest('http://localhost/api/road-permits/rp1', {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    });

const values = () =>
    buildDefaultRoadPermitValues({
        company: null,
        project: {
            id: 'pm1',
            title: '北井門様邸',
            location: '松山市北井門1丁目1-1',
            prefecture: null,
            city: null,
            scheduledStartDate: '2026-09-05',
            scheduledEndDate: '2026-10-04',
        },
        previous: null,
    });

const row = (over: Record<string, unknown> = {}) => ({
    id: 'rp1',
    projectMasterId: 'pm1',
    title: '北井門様邸',
    status: 'draft',
    values: values(),
    documents: buildDefaultRoadPermitDocuments(),
    drawing: null,
    sketchFileId: null,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    deletedAt: null,
    projectMaster: { title: '北井門様邸' },
    ...over,
});

const validBody = () => ({
    title: '北井門様邸（修正）',
    status: 'submitted',
    values: values(),
    documents: buildDefaultRoadPermitDocuments(),
});

describe('/api/road-permits/[id]', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u2', role: 'admin' } }, error: null });
        (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row());
        (prisma.roadPermit.update as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
        (prisma.roadPermit.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    it('権限が無ければそのエラーを返し、DB は読まない', async () => {
        const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

        expect((await GET(req('GET'), ctx)).status).toBe(403);
        expect((await PUT(req('PUT', validBody()), ctx)).status).toBe(403);
        expect((await DELETE(req('DELETE'), ctx)).status).toBe(403);
        expect(prisma.roadPermit.findUnique).not.toHaveBeenCalled();
        expect(prisma.roadPermit.updateMany).not.toHaveBeenCalled();
    });

    describe('GET', () => {
        it('1 件を返す（values・documents は正規化済み）', async () => {
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ status: '???', documents: { forms: [] } }));
            const res = await GET(req('GET'), ctx);
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json).toMatchObject({ id: 'rp1', projectTitle: '北井門様邸', status: 'draft', createdAt: '2026-09-01T00:00:00.000Z' });
            expect(json.documents.forms).toHaveLength(3);
            expect(json.values.period.useFrom).toBe('2026-09-05');
        });

        it('無い・消してあるものは 404', async () => {
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ deletedAt: new Date() }));
            expect((await GET(req('GET'), ctx)).status).toBe(404);
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(null);
            expect((await GET(req('GET'), ctx)).status).toBe(404);
        });
    });

    describe('PUT', () => {
        it('入力が正しくなければ 400（保存しない）', async () => {
            const body = validBody();
            body.values.period.useFrom = '2026/09/05';
            const res = await PUT(req('PUT', body), ctx);
            expect(res.status).toBe(400);
            expect(prisma.roadPermit.update).not.toHaveBeenCalled();

            const res2 = await PUT(req('PUT', { ...validBody(), title: '  ' }), ctx);
            expect(res2.status).toBe(400);
        });

        it('消してあるものは 404', async () => {
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ deletedAt: new Date() }));
            const res = await PUT(req('PUT', validBody()), ctx);
            expect(res.status).toBe(404);
            expect(prisma.roadPermit.update).not.toHaveBeenCalled();
        });

        it('保存すると update に 名前・状態・入力値・様式・更新者 を渡して 1 件を返す', async () => {
            const body = validBody();
            body.values.police.method = '歩道上に足場を設置';
            const res = await PUT(req('PUT', body), ctx);
            const json = await res.json();
            expect(res.status).toBe(200);

            const args = (prisma.roadPermit.update as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ id: 'rp1' });
            expect(args.data).toMatchObject({ title: '北井門様邸（修正）', status: 'submitted', updatedBy: 'u2' });
            expect(args.data.values.police.method).toBe('歩道上に足場を設置');
            expect(args.data.documents.forms).toHaveLength(3);
            expect(json).toMatchObject({ id: 'rp1', title: '北井門様邸（修正）', status: 'submitted' });
        });

        it('画面が送った許可書（permitFiles）は捨て、DB の値を残す（ファイルの一覧はサーバーだけが書く）', async () => {
            const dbFile = {
                id: 'f-db',
                fileName: '許可書.pdf',
                storagePath: 'road-permits/rp1/f-db.pdf',
                mimeType: 'application/pdf',
                size: 1000,
                uploadedAt: '2026-10-14T00:00:00.000Z',
                uploadedBy: 'u1',
                uploadedByName: '担当A',
            };
            const dbDocs = buildDefaultRoadPermitDocuments();
            dbDocs.forms[0].permitFiles = [dbFile];
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ documents: dbDocs }));

            const body = validBody();
            body.documents.forms[0].submittedDate = '2026-10-01';
            body.documents.forms[0].permitFiles = [{ ...dbFile, id: 'f-fake', storagePath: 'road-permits/rp1/f-fake.pdf' }];
            body.documents.forms[1].permitFiles = [{ ...dbFile, id: 'f-fake2' }];
            const res = await PUT(req('PUT', body), ctx);
            expect(res.status).toBe(200);

            const args = (prisma.roadPermit.update as jest.Mock).mock.calls[0][0];
            expect(args.data.documents.forms[0].submittedDate).toBe('2026-10-01');
            expect(args.data.documents.forms[0].permitFiles).toEqual([dbFile]);
            expect(args.data.documents.forms[1].permitFiles).toEqual([]);
        });
    });

    describe('DELETE', () => {
        it('論理削除: updateMany で deletedAt と更新者を入れ、{ ok, id } を返す', async () => {
            const res = await DELETE(req('DELETE'), ctx);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ ok: true, id: 'rp1' });

            const args = (prisma.roadPermit.updateMany as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ id: 'rp1', deletedAt: null });
            expect(args.data.deletedAt).toBeInstanceOf(Date);
            expect(args.data.updatedBy).toBe('u2');
            expect(prisma.roadPermit.delete).not.toHaveBeenCalled();
        });

        it('無い・もう消してあるもの（count 0）は 404', async () => {
            (prisma.roadPermit.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
            const res = await DELETE(req('DELETE'), ctx);
            expect(res.status).toBe(404);
        });
    });
});
