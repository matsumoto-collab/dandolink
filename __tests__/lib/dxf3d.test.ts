import { buildScaffold3DPayload, decodeDxfArrayBuffer } from '@/lib/dxf3d';

// DXFの (コード, 値) 行ペアを組み立てるヘルパ
const dxf = (pairs: [number | string, string][]) => pairs.map(([c, v]) => `${c}\r\n${v}`).join('\r\n') + '\r\n';

// 1辺1000の正方形（四角形3DFACE）を1枚持つ最小DXF
const QUAD_DXF = dxf([
    [0, 'SECTION'],
    [2, 'ENTITIES'],
    [0, '3DFACE'],
    [8, 'SCAFFOLD'],
    [10, '0.0'], [20, '0.0'], [30, '0.0'],
    [11, '1000.0'], [21, '0.0'], [31, '0.0'],
    [12, '1000.0'], [22, '1000.0'], [32, '0.0'],
    [13, '0.0'], [23, '1000.0'], [33, '0.0'],
    [0, 'ENDSEC'],
    [0, 'EOF'],
]);

const b64ToFloats = (b64: string) => new Float32Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer);

describe('buildScaffold3DPayload', () => {
    it('四角形の3DFACEを三角形2枚に分割し、レイヤー名・サイズを保持する', () => {
        const p = buildScaffold3DPayload(QUAD_DXF)!;
        expect(p).not.toBeNull();
        expect(p.triangleCount).toBe(2);
        expect(p.layers).toHaveLength(1);
        expect(p.layers[0].name).toBe('SCAFFOLD');
        expect(p.size).toEqual([1000, 1000, 0]);

        // 中心が原点に来るよう平行移動されている（0..1000 → -500..500）
        const floats = b64ToFloats(p.layers[0].b64);
        expect(floats).toHaveLength(2 * 9);
        expect(Math.min(...floats)).toBe(-500);
        expect(Math.max(...floats)).toBe(500);
    });

    it('4隅目が3隅目と同じ場合は三角形1枚として扱う', () => {
        const tri = dxf([
            [0, 'SECTION'],
            [2, 'ENTITIES'],
            [0, '3DFACE'],
            [8, '0'],
            [10, '0'], [20, '0'], [30, '0'],
            [11, '100'], [21, '0'], [31, '0'],
            [12, '100'], [22, '100'], [32, '50'],
            [13, '100'], [23, '100'], [33, '50'], // = 3隅目
            [0, 'ENDSEC'],
            [0, 'EOF'],
        ]);
        const p = buildScaffold3DPayload(tri)!;
        expect(p.triangleCount).toBe(1);
        expect(p.size).toEqual([100, 100, 50]);
    });

    it('ENTITIES外の3DFACEは拾わない・3DFACEが無ければnull', () => {
        const noEntities = dxf([
            [0, 'SECTION'],
            [2, 'BLOCKS'],
            [0, '3DFACE'],
            [10, '0'], [20, '0'], [30, '0'],
            [11, '1'], [21, '0'], [31, '0'],
            [12, '1'], [22, '1'], [32, '0'],
            [0, 'ENDSEC'],
            [0, 'EOF'],
        ]);
        expect(buildScaffold3DPayload(noEntities)).toBeNull();

        const twoD = dxf([
            [0, 'SECTION'],
            [2, 'ENTITIES'],
            [0, 'LINE'],
            [10, '0'], [20, '0'],
            [11, '100'], [21, '100'],
            [0, 'ENDSEC'],
            [0, 'EOF'],
        ]);
        expect(buildScaffold3DPayload(twoD)).toBeNull();
    });

    it('複数レイヤーを三角形数の多い順に並べる', () => {
        const face = (layer: string, x: number) => ([
            [0, '3DFACE'],
            [8, layer],
            [10, `${x}`], [20, '0'], [30, '0'],
            [11, `${x + 10}`], [21, '0'], [31, '0'],
            [12, `${x + 10}`], [22, '10'], [32, '0'],
            [13, `${x}`], [23, '10'], [33, '0'],
        ] as [number | string, string][]);
        const multi = dxf([
            [0, 'SECTION'],
            [2, 'ENTITIES'],
            ...face('A', 0),
            ...face('B', 100),
            ...face('B', 200),
            [0, 'ENDSEC'],
            [0, 'EOF'],
        ]);
        const p = buildScaffold3DPayload(multi)!;
        expect(p.layers.map((l) => l.name)).toEqual(['B', 'A']);
        expect(p.layers[0].tris).toBe(4);
        expect(p.layers[1].tris).toBe(2);
    });
});

describe('decodeDxfArrayBuffer', () => {
    it('ASCIIのDXFをそのまま読める', () => {
        const buf = new TextEncoder().encode('  0\r\nSECTION\r\n').buffer as ArrayBuffer;
        expect(decodeDxfArrayBuffer(buf)).toContain('SECTION');
    });
});
