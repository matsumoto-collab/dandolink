/**
 * @jest-environment node
 */
/**
 * /api/road-permits/[id]/files（許可書（スキャン）を付ける）と /files/[fileId]（開く・消す）の配線のテスト。
 * docs/指示書_道路申請_許可書を見ての修正.md §4
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '@/app/api/road-permits/[id]/files/route';
import { DELETE, GET } from '@/app/api/road-permits/[id]/files/[fileId]/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { buildDefaultRoadPermitDocuments, buildDefaultRoadPermitValues } from '@/lib/roadPermit/defaults';
import type { RoadPermitDto, RoadPermitPermitFile } from '@/types/roadPermit';

const uploadMock = jest.fn();
const removeMock = jest.fn();
const signMock = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: {
        storage: {
            from: () => ({
                upload: (...args: unknown[]) => uploadMock(...args),
                remove: (...args: unknown[]) => removeMock(...args),
                createSignedUrl: (...args: unknown[]) => signMock(...args),
            }),
        },
    },
    STORAGE_BUCKET: 'project-master-files',
}));

const ctx = { params: { id: 'rp1' } };
const fileCtx = (fileId: string) => ({ params: { id: 'rp1', fileId } });

const storedFile = (over: Partial<RoadPermitPermitFile> = {}): RoadPermitPermitFile => ({
    id: 'f1',
    fileName: '許可書.pdf',
    storagePath: 'road-permits/rp1/f1.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-10-14T01:00:00.000Z',
    uploadedBy: 'u1',
    uploadedByName: '担当A',
    ...over,
});

const docsWithFile = () => {
    const d = buildDefaultRoadPermitDocuments();
    d.forms[1].permitFiles = [storedFile()];
    return d;
};

const row = (over: Record<string, unknown> = {}) => ({
    id: 'rp1',
    projectMasterId: 'pm1',
    title: '申請',
    status: 'submitted',
    values: buildDefaultRoadPermitValues({ company: null, project: null, previous: null }),
    documents: docsWithFile(),
    drawing: null,
    sketchFileId: null,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    deletedAt: null,
    projectMaster: { title: '案件' },
    ...over,
});

const postReq = (parts: { formId?: string; file?: File | null }) => {
    const fd = new FormData();
    if (parts.formId !== undefined) fd.append('formId', parts.formId);
    if (parts.file) fd.append('file', parts.file);
    return new NextRequest('http://localhost/api/road-permits/rp1/files', { method: 'POST', body: fd });
};
const pdf = (name = 'スキャン.pdf', size = 3000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });
const plainReq = (method: string) => new NextRequest('http://localhost/api/road-permits/rp1/files/f1', { method });

describe('/api/road-permits/[id]/files', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        uploadMock.mockResolvedValue({ error: null });
        removeMock.mockResolvedValue({ error: null });
        signMock.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed?token=abc' }, error: null });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({
            session: { user: { id: 'u2', role: 'manager', name: '担当B' } },
            error: null,
        });
        (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row());
        (prisma.roadPermit.update as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
    });

    it('権限が無ければそのまま 403 を返し、DB も Storage も触らない', async () => {
        const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

        expect((await POST(postReq({ formId: 'police-road-use', file: pdf() }), ctx)).status).toBe(403);
        expect((await GET(plainReq('GET'), fileCtx('f1'))).status).toBe(403);
        expect((await DELETE(plainReq('DELETE'), fileCtx('f1'))).status).toBe(403);
        expect(prisma.roadPermit.findUnique).not.toHaveBeenCalled();
        expect(uploadMock).not.toHaveBeenCalled();
        expect(removeMock).not.toHaveBeenCalled();
        expect(signMock).not.toHaveBeenCalled();
    });

    describe('POST（付ける）', () => {
        it('ファイル無し・未知の様式・PDF/画像以外・20MB 超は 400（upload しない）', async () => {
            expect((await POST(postReq({ formId: 'police-road-use' }), ctx)).status).toBe(400);
            expect((await POST(postReq({ formId: 'unknown-form', file: pdf() }), ctx)).status).toBe(400);
            const text = new File(['abc'], 'memo.txt', { type: 'text/plain' });
            expect((await POST(postReq({ formId: 'police-road-use', file: text }), ctx)).status).toBe(400);
            const big = pdf('big.pdf', 20 * 1024 * 1024 + 1);
            expect((await POST(postReq({ formId: 'police-road-use', file: big }), ctx)).status).toBe(400);
            expect(uploadMock).not.toHaveBeenCalled();
            expect(prisma.roadPermit.update).not.toHaveBeenCalled();
        });

        it('無い・消してある申請は 404（upload しない）', async () => {
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ deletedAt: new Date() }));
            expect((await POST(postReq({ formId: 'police-road-use', file: pdf() }), ctx)).status).toBe(404);
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(null);
            expect((await POST(postReq({ formId: 'police-road-use', file: pdf() }), ctx)).status).toBe(404);
            expect(uploadMock).not.toHaveBeenCalled();
        });

        it('成功: road-permits/rp1/<uuid>.pdf に置き、該当の様式に 1 件足して 201 で DTO を返す', async () => {
            const res = await POST(postReq({ formId: 'police-road-use', file: pdf('警察の許可証.pdf', 3000) }), ctx);
            expect(res.status).toBe(201);

            expect(uploadMock).toHaveBeenCalledTimes(1);
            const [path, , opts] = uploadMock.mock.calls[0];
            expect(path).toMatch(/^road-permits\/rp1\/[0-9a-f-]{36}\.pdf$/);
            expect(opts).toEqual({ contentType: 'application/pdf', upsert: false });

            const args = (prisma.roadPermit.update as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ id: 'rp1' });
            expect(args.data.updatedBy).toBe('u2');
            const police = args.data.documents.forms.find((f: { formId: string }) => f.formId === 'police-road-use');
            expect(police.permitFiles).toHaveLength(1);
            expect(police.permitFiles[0]).toMatchObject({
                fileName: '警察の許可証.pdf',
                size: 3000,
                mimeType: 'application/pdf',
                storagePath: path,
                uploadedBy: 'u2',
                uploadedByName: '担当B',
            });
            // ほかの様式に前からあったファイルは残る
            const apply = args.data.documents.forms.find((f: { formId: string }) => f.formId === 'matsuyama-occupancy-apply');
            expect(apply.permitFiles.map((f: RoadPermitPermitFile) => f.id)).toEqual(['f1']);

            const json = (await res.json()) as RoadPermitDto;
            const dtoPolice = json.documents.forms.find((f) => f.formId === 'police-road-use')!;
            expect(dtoPolice.permitFiles[0].fileName).toBe('警察の許可証.pdf');
        });

        it('記録（update）に失敗したら置いたファイルを消して 500', async () => {
            (prisma.roadPermit.update as jest.Mock).mockRejectedValue(new Error('db down'));
            const res = await POST(postReq({ formId: 'police-road-use', file: pdf() }), ctx);
            expect(res.status).toBe(500);
            const [path] = uploadMock.mock.calls[0];
            expect(removeMock).toHaveBeenCalledWith([path]);
        });

        it('Storage への upload に失敗したら 500（記録しない）', async () => {
            uploadMock.mockResolvedValue({ error: { message: 'bucket error' } });
            const res = await POST(postReq({ formId: 'police-road-use', file: pdf() }), ctx);
            expect(res.status).toBe(500);
            expect(prisma.roadPermit.update).not.toHaveBeenCalled();
        });
    });

    describe('GET（開く）', () => {
        it('署名付き URL へ 302 で転送する', async () => {
            const res = await GET(plainReq('GET'), fileCtx('f1'));
            expect(res.status).toBe(302);
            expect(res.headers.get('Location')).toBe('https://storage.test/signed?token=abc');
            expect(signMock).toHaveBeenCalledWith('road-permits/rp1/f1.pdf', 600);
        });

        it('無いファイル・消してある申請は 404', async () => {
            expect((await GET(plainReq('GET'), fileCtx('nope'))).status).toBe(404);
            (prisma.roadPermit.findUnique as jest.Mock).mockResolvedValue(row({ deletedAt: new Date() }));
            expect((await GET(plainReq('GET'), fileCtx('f1'))).status).toBe(404);
            expect(signMock).not.toHaveBeenCalled();
        });
    });

    describe('DELETE（消す）', () => {
        it('Storage と記録から消して 200 で DTO を返す', async () => {
            const res = await DELETE(plainReq('DELETE'), fileCtx('f1'));
            expect(res.status).toBe(200);
            expect(removeMock).toHaveBeenCalledWith(['road-permits/rp1/f1.pdf']);
            const args = (prisma.roadPermit.update as jest.Mock).mock.calls[0][0];
            expect(args.data.updatedBy).toBe('u2');
            const apply = args.data.documents.forms.find((f: { formId: string }) => f.formId === 'matsuyama-occupancy-apply');
            expect(apply.permitFiles).toEqual([]);
            const json = (await res.json()) as RoadPermitDto;
            expect(json.documents.forms.every((f) => f.permitFiles.length === 0)).toBe(true);
        });

        it('Storage の削除に失敗しても記録は消す', async () => {
            removeMock.mockResolvedValue({ error: { message: 'not found' } });
            const res = await DELETE(plainReq('DELETE'), fileCtx('f1'));
            expect(res.status).toBe(200);
            expect(prisma.roadPermit.update).toHaveBeenCalledTimes(1);
        });

        it('無いファイルは 404（何も消さない）', async () => {
            const res = await DELETE(plainReq('DELETE'), fileCtx('nope'));
            expect(res.status).toBe(404);
            expect(removeMock).not.toHaveBeenCalled();
            expect(prisma.roadPermit.update).not.toHaveBeenCalled();
        });
    });
});
