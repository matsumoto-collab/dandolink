/**
 * 道路申請の記号（Phase 2b）: JWW の文書 → 記号の候補（parseJwwBlocks）のテスト。
 * 入力は手で作った小さな「ezjww の JwwDocument 風」のオブジェクト（kei のデータは使わない）。
 */
import type { JwwDocument, JwwEntity } from 'ezjww';
import { parseJwwBlocks, simplifySymbolGeometry } from '@/lib/roadPermit/symbols/jwwImport';
import { symbolBBox, symbolPrimitiveCount } from '@/lib/roadPermit/symbols/geometry';

// ---------------------------------------------------------------- 材料

const base = (patch: Partial<JwwEntity['base']> = {}): JwwEntity['base'] => ({
    group: 0,
    pen_style: 1,
    pen_color: 2,
    pen_width: 0,
    layer: 0,
    layer_group: 0,
    flag: 0,
    ...patch,
});

const line = (x1: number, y1: number, x2: number, y2: number, b: Partial<JwwEntity['base']> = {}): JwwEntity => ({
    type: 'LINE',
    base: base(b),
    start_x: x1,
    start_y: y1,
    end_x: x2,
    end_y: y2,
});

const arc = (cx: number, cy: number, r: number, startRad: number, sweepRad: number, extra: Partial<JwwEntity> = {}): JwwEntity => ({
    type: 'ARC',
    base: base(),
    center_x: cx,
    center_y: cy,
    radius: r,
    start_angle: startRad,
    arc_angle: sweepRad,
    tilt_angle: 0,
    flatness: 1,
    is_full_circle: false,
    ...extra,
});

const ref = (defNumber: number, x: number, y: number, scale: number, rotation = 0): JwwEntity => ({
    type: 'BLOCK',
    base: base(),
    ref_x: x,
    ref_y: y,
    scale_x: scale,
    scale_y: scale,
    rotation,
    def_number: defNumber,
});

const text = (content: string, x: number, y: number): JwwEntity => ({ type: 'TEXT', base: base(), start_x: x, start_y: y, content });

function doc(opts: {
    blocks: { number: number; name: string; entities: JwwEntity[] }[];
    entities?: JwwEntity[];
    groupScale?: number;
    groupState?: (g: number) => number;
    layerState?: (g: number, l: number) => number;
}): JwwDocument {
    const groups = Array.from({ length: 16 }, (_, g) => ({
        state: opts.groupState ? opts.groupState(g) : 2,
        write_layer: 0,
        scale: opts.groupScale ?? 20,
        protect: 0,
        name: '',
        layers: Array.from({ length: 16 }, (_, l) => ({ state: opts.layerState ? opts.layerState(g, l) : 2, protect: 0, name: '' })),
    }));
    return {
        header: {
            version: 700,
            memo: '',
            paper_size: 3,
            write_layer_group: 0,
            layer_groups: groups,
            palette: null,
            line_types: null,
            pens: null,
            text_presets: null,
        },
        entities: opts.entities ?? [],
        block_defs: opts.blocks.map((b) => ({ number: b.number, is_referenced: true, name: b.name, base: base(), entities: b.entities })),
        images: [],
        block_def_names: {},
        entity_counts: {},
        validation: { total_references: 0, resolved_references: 0, unresolved_def_numbers: [], has_unresolved: false },
        diagnostics: [],
    };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- テスト

describe('parseJwwBlocks', () => {
    it('線だけのブロック: 大きさ・中心が原点・名前の掃除・key＝ブロック番号', () => {
        const d = doc({
            blocks: [
                {
                    number: 7,
                    name: 'コーンバー1500p（CAD素材.com）@@SfigorgFlag@@4',
                    entities: [line(1000, 2000, 2500, 2000), line(1000, 2097, 2500, 2097), line(1000, 2000, 1000, 2097)],
                },
            ],
            entities: [ref(7, 0, 0, 0.05)],
        });
        const { blocks, warnings } = parseJwwBlocks(d);
        expect(warnings).toEqual([]);
        expect(blocks).toHaveLength(1);
        const b = blocks[0];
        expect(b.key).toBe('7');
        expect(b.name).toBe('コーンバー1500p');
        expect(b.rawName).toBe('コーンバー1500p（CAD素材.com）@@SfigorgFlag@@4');
        expect(b.lengthMm).toBeCloseTo(1500, 6);
        expect(b.widthMm).toBeCloseTo(97, 6);
        expect(b.primitiveCount).toBe(3);
        expect(b.scaleApplied).toBe(1);
        expect(b.simplified).toBeNull();
        const bb = symbolBBox(b.geometry);
        expect(bb.minX).toBeCloseTo(-750, 6);
        expect(bb.maxX).toBeCloseTo(750, 6);
        expect(bb.minY).toBeCloseTo(-48.5, 6);
        expect(bb.maxY).toBeCloseTo(48.5, 6);
    });

    it('円弧は範囲だけで測る（半径 10,000 の 0〜10 度が巨大にならない）・角度はラジアン→度', () => {
        const d = doc({ blocks: [{ number: 1, name: 'カーブ', entities: [arc(0, 0, 10000, 0, rad(10))] }], entities: [ref(1, 0, 0, 0.05)] });
        const b = parseJwwBlocks(d).blocks[0];
        expect(b.lengthMm).toBeCloseTo(10000 - 10000 * Math.cos(rad(10)), 0);
        expect(b.widthMm).toBeCloseTo(10000 * Math.sin(rad(10)), 0);
        expect(b.lengthMm).toBeLessThan(200);
        expect(b.geometry.arcs).toHaveLength(5);
        expect(b.geometry.arcs[3]).toBeCloseTo(0, 6);
        expect(b.geometry.arcs[4]).toBeCloseTo(10, 6);
    });

    it('arc_angle が負の円弧は始点と終点を入れ替える・全円は円になる・楕円は折れ線になる', () => {
        const d = doc({
            blocks: [
                {
                    number: 1,
                    name: 'いろいろ',
                    entities: [
                        arc(0, 0, 100, rad(90), rad(-90)),
                        { ...arc(500, 0, 50, 0, Math.PI * 2), type: 'CIRCLE', is_full_circle: true },
                        arc(1000, 0, 100, 0, Math.PI, { flatness: 0.5, tilt_angle: rad(90) }),
                    ],
                },
            ],
            entities: [ref(1, 0, 0, 0.05)],
        });
        const b = parseJwwBlocks(d).blocks[0];
        // 負の円弧: 0〜90 度
        const [, , r, s, e] = b.geometry.arcs;
        expect(r).toBe(100);
        expect(s).toBeCloseTo(0, 6);
        expect(e).toBeCloseTo(90, 6);
        expect(b.geometry.circles).toHaveLength(3);
        expect(b.geometry.circles[2]).toBe(50);
        // 楕円弧（長半径 100・短半径 50・90 度傾き・0〜180 度）→ 折れ線。X は 1000±50、Y は 0〜100
        expect(b.geometry.polylines).toHaveLength(1);
        const poly = b.geometry.polylines[0];
        const xs = poly.filter((_, i) => i % 2 === 0);
        const ys = poly.filter((_, i) => i % 2 === 1);
        const dx = xs.map((x) => x - xs[0]);
        // 始点（t=0）は (1000, 100)・終点（t=180）は (1000, -100)。真ん中は x が −50 ずれる
        expect(Math.min(...dx)).toBeCloseTo(-50, 0);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200, 0);
    });

    it('倍率: 0.05 × 20 ＝ 1 は掛けない／0.02 × 20 ＝ 0.4 は掛けて warnings に出す', () => {
        const blocks = [{ number: 1, name: 'A', entities: [line(0, 0, 1000, 0), line(0, 0, 0, 500)] }];
        const one = parseJwwBlocks(doc({ blocks, entities: [ref(1, 0, 0, 0.05)] }));
        expect(one.blocks[0].scaleApplied).toBe(1);
        expect(one.blocks[0].lengthMm).toBeCloseTo(1000, 6);
        expect(one.warnings).toEqual([]);

        const k = parseJwwBlocks(doc({ blocks, entities: [ref(1, 0, 0, 0.02)] }));
        expect(k.blocks[0].scaleApplied).toBeCloseTo(0.4, 9);
        expect(k.blocks[0].lengthMm).toBeCloseTo(400, 6);
        expect(k.blocks[0].widthMm).toBeCloseTo(200, 6);
        expect(k.warnings).toEqual(['A: 倍率 0.4 を掛けました']);
    });

    it('図の上に置かれていないブロックは倍率 1 のまま（warnings に出す）', () => {
        const r = parseJwwBlocks(doc({ blocks: [{ number: 1, name: 'B', entities: [line(0, 0, 100, 0)] }] }));
        expect(r.blocks[0].scaleApplied).toBe(1);
        expect(r.blocks[0].nearbyTexts).toEqual([]);
        expect(r.warnings).toEqual(['B は図の上に置かれていないので倍率 1 のまま']);
    });

    it('補助線（線種 9・線色 9）と非表示レイヤの要素は除く', () => {
        const d = doc({
            blocks: [
                {
                    number: 1,
                    name: 'C',
                    entities: [
                        line(0, 0, 100, 0),
                        line(0, 0, 5000, 0, { pen_style: 9 }),
                        line(0, 0, 0, 5000, { pen_color: 9 }),
                        line(0, 0, -5000, 0, { layer_group: 3 }),
                        line(0, 0, 0, -5000, { layer: 4 }),
                    ],
                },
            ],
            entities: [ref(1, 0, 0, 0.05)],
            groupState: (g) => (g === 3 ? 0 : 2),
            layerState: (g, l) => (g === 0 && l === 4 ? 0 : 2),
        });
        const r = parseJwwBlocks(d);
        expect(r.blocks[0].primitiveCount).toBe(1);
        expect(r.blocks[0].lengthMm).toBeCloseTo(100, 6);
        expect(r.warnings).toEqual(['C: 補助線 2 本・非表示 2 個を除きました']);
    });

    it('入れ子のブロックを展開する（移動＋回転 90 度）', () => {
        const d = doc({
            blocks: [
                { number: 1, name: '親', entities: [line(0, 0, 1000, 0), ref(2, 1000, 0, 1, Math.PI / 2)] },
                { number: 2, name: '子', entities: [line(0, 0, 100, 0)] },
            ],
            entities: [ref(1, 0, 0, 0.05), ref(2, 100, 100, 0.05)],
        });
        const r = parseJwwBlocks(d);
        const parent = r.blocks.find((b) => b.name === '親')!;
        expect(parent.primitiveCount).toBe(2);
        // 子の線 (0,0)-(100,0) は (1000,0)-(1000,100) になる → 外形 1000×100
        expect(parent.lengthMm).toBeCloseTo(1000, 6);
        expect(parent.widthMm).toBeCloseTo(100, 6);
        const L = parent.geometry.lines;
        // 2 本目（子）は縦の線（x が同じ）
        expect(L[4]).toBeCloseTo(L[6], 6);
        expect(Math.abs(L[7] - L[5])).toBeCloseTo(100, 6);
        // 子のブロックもそれだけで候補に出る
        expect(r.blocks.find((b) => b.name === '子')!.lengthMm).toBeCloseTo(100, 6);
    });

    it('目印（_ で始まる名前）と形の無いブロックは出さない。目印だけなら blocks は空', () => {
        const r = parseJwwBlocks(
            doc({
                blocks: [
                    { number: 1, name: '_Origin', entities: [line(0, 0, 10, 0)] },
                    { number: 2, name: '_Small', entities: [line(0, 0, 10, 0)] },
                    { number: 3, name: '文字だけ', entities: [text('あ', 0, 0)] },
                ],
                entities: [ref(1, 0, 0, 1), ref(2, 0, 0, 1), ref(3, 0, 0, 0.05)],
            }),
        );
        expect(r.blocks).toEqual([]);

        const u = parseJwwBlocks(doc({ blocks: [{ number: 4, name: '*U54@@SfigorgFlag@@4', entities: [line(0, 0, 390, 0)] }], entities: [ref(4, 0, 0, 0.05)] }));
        expect(u.blocks.map((b) => b.name)).toEqual(['*U54']);
    });

    it('SOLID は閉じた折れ線（point3＝point4 なら三角）', () => {
        const solid = (p: number[]): JwwEntity => ({
            type: 'SOLID',
            base: base(),
            point1_x: p[0],
            point1_y: p[1],
            point2_x: p[2],
            point2_y: p[3],
            point3_x: p[4],
            point3_y: p[5],
            point4_x: p[6],
            point4_y: p[7],
        });
        const r = parseJwwBlocks(
            doc({
                blocks: [{ number: 1, name: 'S', entities: [solid([0, 0, 100, 0, 100, 100, 0, 100]), solid([0, 0, 50, 0, 50, 50, 50, 50])] }],
                entities: [ref(1, 0, 0, 0.05)],
            }),
        );
        const polys = r.blocks[0].geometry.polylines;
        expect(polys.map((p) => p.length / 2)).toEqual([5, 4]);
        expect(r.blocks[0].primitiveCount).toBe(4 + 3);
    });

    it('簡略化: しきい値を超えたら短い線を省き、同じ線（向き違いも）を 1 本にする', () => {
        const entities: JwwEntity[] = [
            line(0, 0, 1000, 0),
            line(1000, 0, 0, 0), // 同じ線（逆向き）
            line(0, 0, 1000, 0), // 同じ線
            line(0, 0, 0, 500),
            line(0, 500, 1000, 500),
            line(1000, 0, 1000, 500),
            line(10, 10, 20, 10), // 短い
            line(30, 30, 30, 40), // 短い
            line(50, 50, 55, 55), // 短い
            line(60, 60, 70, 60), // 短い
        ];
        const d = doc({ blocks: [{ number: 1, name: 'D', entities }], entities: [ref(1, 0, 0, 0.05)] });

        const none = parseJwwBlocks(d);
        expect(none.blocks[0].simplified).toBeNull();
        expect(none.blocks[0].primitiveCount).toBe(10);

        const r = parseJwwBlocks(d, { simplifyThreshold: 5, minLenMm: 30 });
        expect(r.blocks[0].simplified).toEqual({ before: 10, after: 4 });
        expect(r.blocks[0].primitiveCount).toBe(4);
        expect(r.blocks[0].lengthMm).toBeCloseTo(1000, 6);
        expect(r.warnings).toEqual([]);

        // 簡略化しても上限を超えるなら、短い線から省いて上限に収める
        const capped = parseJwwBlocks(d, { simplifyThreshold: 5, minLenMm: 30, maxPrimitives: 2 });
        expect(capped.blocks[0].primitiveCount).toBe(2);
        expect(capped.blocks[0].simplified).toEqual({ before: 10, after: 2 });
        expect(capped.warnings).toEqual(['D: 線が多いので、短い線から省いて 2 本に収めました']);
        // 残るのは長い 2 本（1000 の線）
        expect(capped.blocks[0].lengthMm).toBeCloseTo(1000, 6);
    });

    it('simplifySymbolGeometry: 連続線は短い区間の点を飛ばし、全体が短い連続線は省く', () => {
        const g = simplifySymbolGeometry(
            {
                lines: [],
                circles: [],
                arcs: [],
                polylines: [
                    [0, 0, 10, 0, 20, 0, 100, 0, 110, 0],
                    [0, 0, 5, 0, 10, 0],
                ],
            },
            30,
        );
        expect(g.polylines).toEqual([[0, 0, 100, 0, 110, 0]]);
        expect(symbolPrimitiveCount(g)).toBe(2);
    });

    it('nearbyTexts: 参照の近くの文字を近い順に 3 つまで（配布元の表示・宣伝文・寸法の数字・遠い文字は除く）', () => {
        // ブロックは実寸 390×390（用紙では 0.05 倍＝19.5mm 角）。R＝390×0.05×1.5＋20＝49.25mm
        const d = doc({
            blocks: [{ number: 1, name: '*U54', entities: [line(-195, -195, 195, 195)] }],
            entities: [
                ref(1, 100, 100, 0.05),
                text('カラーコーン', 100, 130),
                text('上から見た図', 100, 110),
                text('CAD素材.com', 100, 101),
                text('https://example.com', 100, 102),
                text('390', 100, 103),
                text('その他、便利なCADデータ配布中', 100, 104),
                text('コーンベット', 140, 100),
                text('遠い文字', 300, 300),
                text('4 つめ', 145, 100),
            ],
        });
        const b = parseJwwBlocks(d).blocks[0];
        expect(b.nearbyTexts).toEqual(['上から見た図', 'カラーコーン', 'コーンベット']);
    });

    it('JWS（縮尺は header.group_scales）も読める', () => {
        const base0 = doc({ blocks: [{ number: 1, name: 'E', entities: [line(0, 0, 1000, 0), line(0, 0, 0, 100)] }], entities: [ref(1, 0, 0, 0.1)] });
        const jws = {
            ...base0,
            header: {
                version: 1,
                origin: { x: 0, y: 0 },
                group_scales: Array.from({ length: 16 }, () => 10),
                bounds_min: { x: 0, y: 0 },
                bounds_max: { x: 0, y: 0 },
                reserved_prefix: [],
                reserved_integers: [],
                reserved_reals: [],
            },
        };
        const r = parseJwwBlocks(jws);
        expect(r.blocks[0].scaleApplied).toBe(1);
        expect(r.blocks[0].lengthMm).toBeCloseTo(1000, 6);
        expect(r.warnings).toEqual([]);
    });
});
