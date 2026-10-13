/**
 * @jest-environment node
 */
/**
 * /api/road-permits/symbols（記号の一覧・登録）・/symbols/[id]（変更）・/symbols/parse（JWW の読み取り）の配線のテスト。
 * 形の取り出しの中身は __tests__/lib/roadPermitSymbolsJwwImport.test.ts で見ている。ここは
 * 権限・入力チェック・DB の読み書き・応答の形を見る。parse は ezjww をモックにして wasm を読まない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/road-permits/symbols/route';
import { PUT } from '@/app/api/road-permits/symbols/[id]/route';
import { POST as PARSE } from '@/app/api/road-permits/symbols/parse/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, validationErrorResponse } from '@/lib/api/utils';

const mockEz = {
    detectFileFormat: jest.fn(),
    readDocument: jest.fn(),
    readJwsDocument: jest.fn(),
};
jest.mock('ezjww', () => ({
    detectFileFormat: (...a: unknown[]) => mockEz.detectFileFormat(...a),
    readDocument: (...a: unknown[]) => mockEz.readDocument(...a),
    readJwsDocument: (...a: unknown[]) => mockEz.readJwsDocument(...a),
}));

// ---------------------------------------------------------------- 材料

const geometry = { lines: [-750, 0, 750, 0], circles: [], arcs: [], polylines: [] };

const row = (patch: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'コーンバー1500p',
    category: 'cone',
    countLabel: 'コーンバー',
    countUnit: '本',
    countNote: '1.5m',
    geometry,
    lengthMm: 1500,
    widthMm: 97,
    barPitchMm: 1403,
    sourceFile: 'traffic-cone.jww',
    sourceBlock: 'コーンバー1500p',
    sourceNote: '',
    sortOrder: 0,
    isActive: true,
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: new Date('2026-10-13T00:00:00.000Z'),
    updatedAt: new Date('2026-10-13T00:00:00.000Z'),
    ...patch,
});

const createBody = (patch: Record<string, unknown> = {}) => ({
    name: ' コーンバー1500p ',
    category: 'cone',
    countLabel: 'コーンバー',
    countUnit: '本',
    countNote: '1.5m',
    geometry,
    lengthMm: 1500,
    widthMm: 97,
    barPitchMm: 1403,
    sourceFile: 'traffic-cone.jww',
    sourceBlock: 'コーンバー1500p（配布元）',
    sourceNote: '',
    ...patch,
});

const jsonReq = (url: string, method: string, body: unknown) =>
    new NextRequest(url, {
        method,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

const forbidden = () => {
    const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
    (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });
};

beforeEach(() => {
    jest.clearAllMocks();
    (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u1', role: 'manager' } }, error: null });
});

// ---------------------------------------------------------------- GET / POST

describe('/api/road-permits/symbols', () => {
    describe('GET', () => {
        it('権限が無ければそのエラーを返し、DB は読まない', async () => {
            forbidden();
            const res = await GET();
            expect(res.status).toBe(403);
            expect(prisma.roadPermitSymbol.findMany).not.toHaveBeenCalled();
        });

        it('使わないものも含めて全部を、分類 → 並び順 の順で返す（形は正規化・日付は ISO）', async () => {
            (prisma.roadPermitSymbol.findMany as jest.Mock).mockResolvedValue([
                row({ id: 'v1', name: 'エルフ', category: 'vehicle', sortOrder: 0, barPitchMm: null }),
                row({ id: 'c2', name: 'B', sortOrder: 1, isActive: false }),
                row({ id: 'c1', name: 'A', sortOrder: 0, geometry: { lines: [0, 0, 1, 'x'], circles: [0, 0, 5], arcs: 'こわれた' } }),
            ]);
            const res = await GET();
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            const json = await res.json();
            expect(json.symbols.map((s: { id: string }) => s.id)).toEqual(['c1', 'c2', 'v1']);
            expect(json.symbols[0].geometry).toEqual({ lines: [], circles: [0, 0, 5], arcs: [], polylines: [] });
            expect(json.symbols[1].isActive).toBe(false);
            expect(json.symbols[2].barPitchMm).toBeNull();
            expect(json.symbols[0].createdAt).toBe('2026-10-13T00:00:00.000Z');
        });
    });

    describe('POST', () => {
        beforeEach(() => {
            (prisma.roadPermitSymbol.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 4 } });
            (prisma.roadPermitSymbol.create as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
                row({ ...data, id: 'new1' }),
            );
        });

        it('権限が無ければ書かない', async () => {
            forbidden();
            const res = await POST(jsonReq('http://localhost/api/road-permits/symbols', 'POST', createBody()));
            expect(res.status).toBe(403);
            expect(prisma.roadPermitSymbol.create).not.toHaveBeenCalled();
        });

        it('1 件登録: 並び順＝同じ分類の最大＋1・作った人・201 で返す', async () => {
            const res = await POST(jsonReq('http://localhost/api/road-permits/symbols', 'POST', createBody()));
            expect(res.status).toBe(201);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            const json = await res.json();
            expect(json.id).toBe('new1');
            expect(json.name).toBe('コーンバー1500p');

            expect((prisma.roadPermitSymbol.aggregate as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { category: 'cone' } });
            const data = (prisma.roadPermitSymbol.create as jest.Mock).mock.calls[0][0].data;
            expect(data).toMatchObject({
                name: 'コーンバー1500p',
                category: 'cone',
                sortOrder: 5,
                barPitchMm: 1403,
                isActive: true,
                createdBy: 'u1',
                updatedBy: 'u1',
                geometry,
            });
        });

        it('その分類に 1 つも無ければ並び順は 0', async () => {
            (prisma.roadPermitSymbol.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: null } });
            await POST(jsonReq('http://localhost/api/road-permits/symbols', 'POST', createBody({ barPitchMm: null })));
            const data = (prisma.roadPermitSymbol.create as jest.Mock).mock.calls[0][0].data;
            expect(data.sortOrder).toBe(0);
            expect(data.barPitchMm).toBeNull();
        });

        it.each([
            ['名前が空', { name: '  ' }, '名前'],
            ['分類が違う', { category: 'house' }, '分類'],
            ['形に線が無い', { geometry: { lines: [], circles: [], arcs: [], polylines: [] } }, '線がありません'],
            ['形が無い', { geometry: null }, '形'],
            ['線が多すぎる', { geometry: { lines: Array.from({ length: 4 * 5001 }, (_, i) => i), circles: [], arcs: [], polylines: [] } }, '多すぎ'],
            ['長さが 0', { lengthMm: 0 }, '長さ'],
            ['幅が大きすぎる', { widthMm: 200_000 }, '幅'],
            ['間隔が小数', { barPitchMm: 1403.5 }, '整数'],
            ['間隔が 0', { barPitchMm: 0 }, '間隔'],
            ['単位が長すぎる', { countUnit: 'あ'.repeat(11) }, '単位'],
        ])('入力が違えば 400 で書かない（%s）', async (_label, patch, word) => {
            const res = await POST(jsonReq('http://localhost/api/road-permits/symbols', 'POST', createBody(patch)));
            expect(res.status).toBe(400);
            expect((validationErrorResponse as jest.Mock).mock.calls[0][0]).toContain(word);
            expect(prisma.roadPermitSymbol.create).not.toHaveBeenCalled();
        });

        it('JSON でなければ 400', async () => {
            const res = await POST(jsonReq('http://localhost/api/road-permits/symbols', 'POST', '{壊れた'));
            expect(res.status).toBe(400);
            expect(prisma.roadPermitSymbol.create).not.toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------- PUT

describe('/api/road-permits/symbols/[id] PUT', () => {
    const ctx = { params: { id: 's1' } };
    const put = (body: unknown) => PUT(jsonReq('http://localhost/api/road-permits/symbols/s1', 'PUT', body), ctx);

    beforeEach(() => {
        (prisma.roadPermitSymbol.findUnique as jest.Mock).mockResolvedValue({ id: 's1', category: 'cone' });
        (prisma.roadPermitSymbol.update as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data));
        (prisma.roadPermitSymbol.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 2 } });
    });

    it('権限が無ければ書かない', async () => {
        forbidden();
        const res = await put({ name: 'x' });
        expect(res.status).toBe(403);
        expect(prisma.roadPermitSymbol.update).not.toHaveBeenCalled();
    });

    it('無ければ 404', async () => {
        (prisma.roadPermitSymbol.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await put({ name: 'x' });
        expect(res.status).toBe(404);
        expect(prisma.roadPermitSymbol.update).not.toHaveBeenCalled();
    });

    it('名前・使う／使わない・並び順を変える。形・大きさ・取り込み元は送られても書かない', async () => {
        const res = await put({
            name: ' カラーコーン ',
            isActive: false,
            sortOrder: 3,
            geometry: { lines: [0, 0, 1, 1], circles: [], arcs: [], polylines: [] },
            lengthMm: 1,
            widthMm: 1,
            sourceFile: 'x.jww',
            sourceBlock: 'x',
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const args = (prisma.roadPermitSymbol.update as jest.Mock).mock.calls[0][0];
        expect(args.where).toEqual({ id: 's1' });
        expect(args.data).toEqual({ name: 'カラーコーン', isActive: false, sortOrder: 3, updatedBy: 'u1' });
        const json = await res.json();
        expect(json.name).toBe('カラーコーン');
        expect(json.isActive).toBe(false);
    });

    it('分類を変えて並び順の指定が無ければ、新しい分類の最後に付ける', async () => {
        await put({ category: 'vehicle' });
        expect((prisma.roadPermitSymbol.aggregate as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { category: 'vehicle' } });
        expect((prisma.roadPermitSymbol.update as jest.Mock).mock.calls[0][0].data).toEqual({ category: 'vehicle', sortOrder: 3, updatedBy: 'u1' });
    });

    it('コーンバーをやめる（間隔を null）', async () => {
        await put({ barPitchMm: null });
        expect((prisma.roadPermitSymbol.update as jest.Mock).mock.calls[0][0].data).toEqual({ barPitchMm: null, updatedBy: 'u1' });
    });

    it.each([
        ['名前が空', { name: '' }],
        ['分類が違う', { category: 'x' }],
        ['並び順が負', { sortOrder: -1 }],
        ['使う／使わないが文字', { isActive: 'yes' }],
        ['間隔が 0', { barPitchMm: 0 }],
    ])('入力が違えば 400（%s）', async (_label, body) => {
        const res = await put(body);
        expect(res.status).toBe(400);
        expect(prisma.roadPermitSymbol.update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------- parse

describe('/api/road-permits/symbols/parse POST', () => {
    const fileReq = (name: string | null, size = 10, extra?: (fd: FormData) => void) => {
        const fd = new FormData();
        if (name) fd.append('file', new File([new Uint8Array(size)], name));
        extra?.(fd);
        return new NextRequest('http://localhost/api/road-permits/symbols/parse', { method: 'POST', body: fd });
    };

    /** 小さな JWW 風の文書（ブロック 1 つ） */
    const jwwDoc = (blocks: { number: number; name: string; entities: unknown[] }[]) => ({
        header: { layer_groups: Array.from({ length: 16 }, () => ({ state: 2, scale: 20, layers: [] })) },
        entities: [{ type: 'BLOCK', base: { layer_group: 0, layer: 0 }, ref_x: 0, ref_y: 0, scale_x: 0.05, scale_y: 0.05, rotation: 0, def_number: 1 }],
        block_defs: blocks.map((b) => ({ ...b, is_referenced: true, base: {} })),
    });
    const lineEntity = (x1: number, y1: number, x2: number, y2: number) => ({
        type: 'LINE',
        base: { pen_style: 1, pen_color: 2, layer: 0, layer_group: 0 },
        start_x: x1,
        start_y: y1,
        end_x: x2,
        end_y: y2,
    });

    it('権限が無ければ読まない', async () => {
        forbidden();
        const res = await PARSE(fileReq('a.jww'));
        expect(res.status).toBe(403);
        expect(mockEz.detectFileFormat).not.toHaveBeenCalled();
    });

    it('JWW を読んでブロックの候補を返す（ファイル名・形・大きさ）', async () => {
        mockEz.detectFileFormat.mockReturnValue('jww');
        mockEz.readDocument.mockReturnValue(
            jwwDoc([
                { number: 1, name: '*U54@@SfigorgFlag@@4', entities: [lineEntity(0, 0, 390, 0), lineEntity(0, 0, 0, 390)] },
                { number: 2, name: '_Origin', entities: [lineEntity(0, 0, 1, 0)] },
            ]),
        );
        const res = await PARSE(fileReq('traffic-cone.JWW'));
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const json = await res.json();
        expect(json.fileName).toBe('traffic-cone.JWW');
        expect(json.blocks).toHaveLength(1);
        expect(json.blocks[0]).toMatchObject({ key: '1', name: '*U54', lengthMm: 390, widthMm: 390, primitiveCount: 2, scaleApplied: 1 });
        expect(json.warnings).toEqual([]);
        expect(mockEz.readDocument).toHaveBeenCalledTimes(1);
        expect(mockEz.readDocument.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    });

    it('JWS は readJwsDocument で読む', async () => {
        mockEz.detectFileFormat.mockReturnValue('jws');
        const d = jwwDoc([{ number: 1, name: 'A', entities: [lineEntity(0, 0, 100, 0)] }]);
        mockEz.readJwsDocument.mockReturnValue({ ...d, header: { group_scales: Array.from({ length: 16 }, () => 20) } });
        const res = await PARSE(fileReq('a.jws'));
        expect(res.status).toBe(200);
        expect(mockEz.readJwsDocument).toHaveBeenCalledTimes(1);
        expect(mockEz.readDocument).not.toHaveBeenCalled();
    });

    it('ファイルが無い・拡張子が違う・大きすぎる なら 400（読まない）', async () => {
        expect((await PARSE(fileReq(null))).status).toBe(400);
        expect((await PARSE(fileReq('a.dxf'))).status).toBe(400);
        expect((await PARSE(fileReq('a.jww', 10 * 1024 * 1024 + 1))).status).toBe(400);
        expect(mockEz.detectFileFormat).not.toHaveBeenCalled();
    });

    it('JWC は「JWW か JWS を選んでください」で 400・判定できなければ 400', async () => {
        mockEz.detectFileFormat.mockReturnValue('jwc');
        const res = await PARSE(fileReq('a.jww'));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('JWW か JWS');

        mockEz.detectFileFormat.mockReturnValue(null);
        expect((await PARSE(fileReq('a.jww'))).status).toBe(400);
        expect(mockEz.readDocument).not.toHaveBeenCalled();
    });

    it('読めなければ 400', async () => {
        mockEz.detectFileFormat.mockReturnValue('jww');
        mockEz.readDocument.mockImplementation(() => {
            throw new Error('broken');
        });
        const res = await PARSE(fileReq('a.jww'));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('読めませんでした');
    });

    it('目印以外のブロックが無ければ 400（ブロック化してから取り込む）', async () => {
        mockEz.detectFileFormat.mockReturnValue('jww');
        mockEz.readDocument.mockReturnValue(jwwDoc([{ number: 1, name: '_Origin', entities: [lineEntity(0, 0, 1, 0)] }]));
        const res = await PARSE(fileReq('a.jww'));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('ブロックがありません');
    });
});
