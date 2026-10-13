/**
 * JWW（ezjww で読んだ文書）→ 記号の候補（純粋関数。docs/指示書_道路申請_Phase2b_記号.md §3.2・§3.3）。
 *
 * - ezjww は型だけ読む（実行時に読まない＝wasm を読まない。読むのは API ルート app/api/road-permits/symbols/parse）
 * - ブロック（block_defs）ごとに 線・円・円弧・連続線 を取り出し、実寸 mm・中心が原点 の形にする
 * - 円弧は start_angle〜start_angle＋arc_angle の範囲だけ（円全体にしない。大きさも範囲で測る）
 * - 補助線・非表示レイヤの要素は除く。入れ子のブロックは展開する
 * - 線が多すぎる形は簡略化する（短い線を省く・重なった線を 1 本に）
 */
import type { BlockDef, JwsDocument, JwwDocument, JwwEntity } from 'ezjww';
import type { ParsedJwwBlock, RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';
import { centerSymbolGeometry, scaleSymbolGeometry, symbolBBox, symbolPrimitiveCount } from '@/lib/roadPermit/symbols/geometry';
import {
    ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES,
    ROAD_PERMIT_SYMBOL_SIMPLIFY_THRESHOLD,
    cleanJwwBlockName,
    isMarkerBlockName,
} from '@/lib/roadPermit/symbols/normalize';

export interface ParseJwwBlocksOptions {
    /** これを超える形を簡略化する（既定 ROAD_PERMIT_SYMBOL_SIMPLIFY_THRESHOLD＝2000） */
    simplifyThreshold?: number;
    /** 簡略化で省く線の長さ（実寸 mm・既定 30） */
    minLenMm?: number;
    /** 1 つの形の上限（既定 ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES＝5000） */
    maxPrimitives?: number;
}

export interface ParseJwwBlocksResult {
    blocks: ParsedJwwBlock[];
    warnings: string[];
}

/** 楕円・楕円弧を折れ線にするときの刻み（度） */
const ELLIPSE_STEP_DEG = 5;
/** 入れ子のブロックを展開する深さの上限 */
const MAX_NEST_DEPTH = 8;
/** 補助線の線種・線色（Jw_cad の決まり） */
const AUX_PEN = 9;
const EPS = 1e-6;

/** 2 次元のアフィン変換 x' = a x + c y + e、y' = b x + d y + f */
interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function apply(m: Affine, x: number, y: number): [number, number] {
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** m の後に n を掛ける（先に n、次に m）＝ m∘n */
function compose(m: Affine, n: Affine): Affine {
    return {
        a: m.a * n.a + m.c * n.b,
        b: m.b * n.a + m.d * n.b,
        c: m.a * n.c + m.c * n.d,
        d: m.b * n.c + m.d * n.d,
        e: m.a * n.e + m.c * n.f + m.e,
        f: m.b * n.e + m.d * n.f + m.f,
    };
}

/** BLOCK 参照の変換（拡大 → 回転（ラジアン）→ 移動） */
function blockRefAffine(ref: JwwEntity): Affine {
    const sx = num(ref.scale_x, 1);
    const sy = num(ref.scale_y, 1);
    const r = num(ref.rotation, 0);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: num(ref.ref_x, 0), f: num(ref.ref_y, 0) };
}

/** 回転＋等倍の拡大だけ（反転なし）なら その倍率と回転（ラジアン）。そうでなければ null（円弧を折れ線にする） */
function similarity(m: Affine): { s: number; rot: number } | null {
    const s1 = Math.hypot(m.a, m.b);
    const s2 = Math.hypot(m.c, m.d);
    if (s1 < EPS) return null;
    if (Math.abs(s1 - s2) > 1e-9 * Math.max(1, s1)) return null;
    const det = m.a * m.d - m.b * m.c;
    if (det <= 0) return null;
    // 直交していること
    if (Math.abs(m.a * m.c + m.b * m.d) > 1e-9 * Math.max(1, s1 * s2)) return null;
    return { s: s1, rot: Math.atan2(m.b, m.a) };
}

function num(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const isOne = (v: number) => Math.abs(v - 1) <= 1e-6;
const rad2deg = (r: number) => (r * 180) / Math.PI;

/** 形を組み立てる入れ物 */
class GeometryBuilder {
    lines: number[] = [];
    circles: number[] = [];
    arcs: number[] = [];
    polylines: number[][] = [];

    line(m: Affine, x1: number, y1: number, x2: number, y2: number) {
        const a = apply(m, x1, y1);
        const b = apply(m, x2, y2);
        this.lines.push(a[0], a[1], b[0], b[1]);
    }

    polyline(m: Affine, pts: [number, number][]) {
        if (pts.length < 2) return;
        const out: number[] = [];
        for (const [x, y] of pts) {
            const p = apply(m, x, y);
            out.push(p[0], p[1]);
        }
        this.polylines.push(out);
    }

    /**
     * 円・円弧・楕円・楕円弧（JWW の要素の値のまま。角度はラジアン）。
     * flatness≒1 で変換が相似なら 円／円弧 のまま、それ以外は折れ線にする。
     */
    arc(m: Affine, e: JwwEntity, full: boolean) {
        const cx = num(e.center_x, 0);
        const cy = num(e.center_y, 0);
        const r = num(e.radius, 0);
        if (r <= 0) return;
        const flat = num(e.flatness, 1);
        const tilt = num(e.tilt_angle, 0);
        let start = num(e.start_angle, 0);
        let sweep = num(e.arc_angle, 0);
        if (!full && Math.abs(sweep) >= Math.PI * 2 - 1e-9) full = true;
        if (!full && sweep < 0) {
            // 時計回りの円弧 → 始点と終点を入れ替えて反時計回りにする
            start += sweep;
            sweep = -sweep;
        }
        if (!full && sweep < EPS) return;

        const sim = similarity(m);
        if (Math.abs(flat - 1) <= 1e-6 && sim) {
            const c = apply(m, cx, cy);
            const rr = r * sim.s;
            if (full) {
                this.circles.push(c[0], c[1], rr);
            } else {
                const s = start + tilt + sim.rot;
                this.arcs.push(c[0], c[1], rr, rad2deg(s), rad2deg(s + sweep));
            }
            return;
        }
        // 楕円（弧）→ 折れ線（tilt を反映。角度は楕円の媒介変数）
        const total = full ? Math.PI * 2 : sweep;
        const t0 = full ? 0 : start;
        const n = Math.max(2, Math.ceil(rad2deg(total) / ELLIPSE_STEP_DEG));
        const cosT = Math.cos(tilt);
        const sinT = Math.sin(tilt);
        const pts: [number, number][] = [];
        for (let i = 0; i <= n; i++) {
            const t = t0 + (total * i) / n;
            const lx = r * Math.cos(t);
            const ly = r * flat * Math.sin(t);
            pts.push([cx + lx * cosT - ly * sinT, cy + lx * sinT + ly * cosT]);
        }
        this.polyline(m, pts);
    }

    build(): RoadPermitSymbolGeometry {
        return { lines: this.lines, circles: this.circles, arcs: this.arcs, polylines: this.polylines };
    }
}

interface CollectContext {
    defs: Map<number, BlockDef>;
    isHidden: (e: JwwEntity) => boolean;
    aux: number;
    hidden: number;
    missingDefs: number;
}

function isAux(e: JwwEntity): boolean {
    return e.base?.pen_style === AUX_PEN || e.base?.pen_color === AUX_PEN;
}

/** 要素を形に入れる（入れ子のブロックは展開する） */
function collect(entities: readonly JwwEntity[], m: Affine, depth: number, ctx: CollectContext, out: GeometryBuilder) {
    for (const e of entities) {
        if (e.type === 'BLOCK') {
            if (depth >= MAX_NEST_DEPTH) continue;
            if (ctx.isHidden(e)) {
                ctx.hidden++;
                continue;
            }
            const child = typeof e.def_number === 'number' ? ctx.defs.get(e.def_number) : undefined;
            if (!child) {
                ctx.missingDefs++;
                continue;
            }
            collect(child.entities, compose(m, blockRefAffine(e)), depth + 1, ctx, out);
            continue;
        }
        if (e.type !== 'LINE' && e.type !== 'CIRCLE' && e.type !== 'ARC' && e.type !== 'SOLID') continue;
        if (isAux(e)) {
            ctx.aux++;
            continue;
        }
        if (ctx.isHidden(e)) {
            ctx.hidden++;
            continue;
        }
        switch (e.type) {
            case 'LINE':
                out.line(m, num(e.start_x, 0), num(e.start_y, 0), num(e.end_x, 0), num(e.end_y, 0));
                break;
            case 'CIRCLE':
                out.arc(m, e, true);
                break;
            case 'ARC':
                out.arc(m, e, e.is_full_circle === true);
                break;
            case 'SOLID': {
                const p: [number, number][] = [
                    [num(e.point1_x, 0), num(e.point1_y, 0)],
                    [num(e.point2_x, 0), num(e.point2_y, 0)],
                    [num(e.point3_x, 0), num(e.point3_y, 0)],
                    [num(e.point4_x, 0), num(e.point4_y, 0)],
                ];
                const tri = Math.abs(p[2][0] - p[3][0]) < EPS && Math.abs(p[2][1] - p[3][1]) < EPS;
                const ring = tri ? [p[0], p[1], p[2], p[0]] : [p[0], p[1], p[2], p[3], p[0]];
                out.polyline(m, ring);
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 簡略化
// ---------------------------------------------------------------------------

function segLen(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x2 - x1, y2 - y1);
}

/** 同じ線か見るための鍵（端点を 0.01mm に丸め、向きをそろえる） */
function lineKey(x1: number, y1: number, x2: number, y2: number): string {
    const r = (v: number) => Math.round(v * 100);
    const a = `${r(x1)},${r(y1)}`;
    const b = `${r(x2)},${r(y2)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 簡略化: 短い線（minLenMm 未満）を省き、同じ線を 1 本にする。
 * 連続線は、前に残した点から minLenMm 未満の点を飛ばす（最後の点は残す）。全体の長さが minLenMm 未満なら省く。
 */
export function simplifySymbolGeometry(g: RoadPermitSymbolGeometry, minLenMm: number): RoadPermitSymbolGeometry {
    const lines: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i + 3 < g.lines.length; i += 4) {
        const [x1, y1, x2, y2] = [g.lines[i], g.lines[i + 1], g.lines[i + 2], g.lines[i + 3]];
        if (segLen(x1, y1, x2, y2) < minLenMm) continue;
        const k = lineKey(x1, y1, x2, y2);
        if (seen.has(k)) continue;
        seen.add(k);
        lines.push(x1, y1, x2, y2);
    }
    const polylines: number[][] = [];
    for (const poly of g.polylines) {
        if (poly.length < 4) continue;
        const out: number[] = [poly[0], poly[1]];
        let total = 0;
        for (let i = 2; i + 1 < poly.length; i += 2) {
            const lx = out[out.length - 2];
            const ly = out[out.length - 1];
            const isLast = i + 2 >= poly.length;
            const d = segLen(lx, ly, poly[i], poly[i + 1]);
            if (d >= minLenMm || (isLast && d > 0)) {
                out.push(poly[i], poly[i + 1]);
                total += d;
            }
        }
        if (out.length < 4 || total < minLenMm) continue;
        if (out.length === 4) {
            const k = lineKey(out[0], out[1], out[2], out[3]);
            if (seen.has(k)) continue;
            seen.add(k);
        }
        polylines.push(out);
    }
    return { lines, circles: [...g.circles], arcs: [...g.arcs], polylines };
}

/** 上限を超えた形を、長いものから max 区間まで残して収める */
function capGeometry(g: RoadPermitSymbolGeometry, max: number): RoadPermitSymbolGeometry {
    type Item = { len: number; cost: number; put: (o: RoadPermitSymbolGeometry) => void };
    const items: Item[] = [];
    for (let i = 0; i + 3 < g.lines.length; i += 4) {
        const v = g.lines.slice(i, i + 4);
        items.push({ len: segLen(v[0], v[1], v[2], v[3]), cost: 1, put: (o) => o.lines.push(...v) });
    }
    for (let i = 0; i + 2 < g.circles.length; i += 3) {
        const v = g.circles.slice(i, i + 3);
        items.push({ len: 2 * Math.PI * v[2], cost: 1, put: (o) => o.circles.push(...v) });
    }
    for (let i = 0; i + 4 < g.arcs.length; i += 5) {
        const v = g.arcs.slice(i, i + 5);
        let sweep = v[4] - v[3];
        while (sweep <= 0) sweep += 360;
        items.push({ len: (v[2] * sweep * Math.PI) / 180, cost: 1, put: (o) => o.arcs.push(...v) });
    }
    for (const poly of g.polylines) {
        let len = 0;
        for (let i = 2; i + 1 < poly.length; i += 2) len += segLen(poly[i - 2], poly[i - 1], poly[i], poly[i + 1]);
        items.push({ len, cost: Math.max(0, poly.length / 2 - 1), put: (o) => o.polylines.push(poly) });
    }
    items.sort((a, b) => b.len - a.len);
    const out: RoadPermitSymbolGeometry = { lines: [], circles: [], arcs: [], polylines: [] };
    let used = 0;
    for (const it of items) {
        if (used + it.cost > max) continue;
        it.put(out);
        used += it.cost;
    }
    return out;
}

/**
 * 数を丸める（座標・半径は 0.01mm、円弧の角度は 0.0001 度）。
 * 応答と DB の JSON を小さくするため（丸めないと 17 桁の数が並び、乗用車のファイルで 5MB を超える）。
 */
export function roundSymbolGeometry(g: RoadPermitSymbolGeometry): RoadPermitSymbolGeometry {
    const mm = (v: number) => Math.round(v * 100) / 100 || 0;
    const deg = (v: number) => Math.round(v * 10000) / 10000 || 0;
    const arcs: number[] = [];
    for (let i = 0; i + 4 < g.arcs.length; i += 5) {
        arcs.push(mm(g.arcs[i]), mm(g.arcs[i + 1]), mm(g.arcs[i + 2]), deg(g.arcs[i + 3]), deg(g.arcs[i + 4]));
    }
    return { lines: g.lines.map(mm), circles: g.circles.map(mm), arcs, polylines: g.polylines.map((p) => p.map(mm)) };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

type AnyJwwDocument = JwwDocument | JwsDocument;

function isJws(doc: AnyJwwDocument): doc is JwsDocument {
    return Array.isArray((doc.header as { group_scales?: unknown }).group_scales);
}

/** レイヤグループの縮尺（JWW＝layer_groups[g].scale・JWS＝group_scales[g]）。読めなければ 1 */
function groupScale(doc: AnyJwwDocument, g: number): number {
    if (isJws(doc)) return num(doc.header.group_scales[g], 1);
    return num(doc.header.layer_groups?.[g]?.scale, 1);
}

/** 非表示レイヤか（JWS はレイヤの表示状態を持たないので常に false） */
function hiddenChecker(doc: AnyJwwDocument): (e: JwwEntity) => boolean {
    if (isJws(doc)) return () => false;
    const groups = doc.header.layer_groups ?? [];
    return (e) => {
        const g = groups[e.base?.layer_group ?? 0];
        if (!g) return false;
        if (g.state === 0) return true;
        const l = g.layers?.[e.base?.layer ?? 0];
        return !!l && l.state === 0;
    };
}

/** 名前の候補にしない文字（配布元の表示・宣伝文（「…配布中」）・寸法の数字だけのもの（例 390・φ80・1,500）） */
function isIgnoredText(s: string): boolean {
    if (s.includes('CAD素材') || s.includes('配布') || s.toLowerCase().includes('http')) return true;
    return /^[\s\d.,，．φΦRr×xX*＊+＋\-−~～()（）/]+$/.test(s);
}

/**
 * JWW の文書 → 記号の候補（ブロックごと）と注意。
 * 目印のブロック（_Origin・_Small）・形の無いブロックは出さない。ブロックが 1 つも無ければ blocks は空（ルートが 400 にする）。
 */
export function parseJwwBlocks(doc: AnyJwwDocument, opts: ParseJwwBlocksOptions = {}): ParseJwwBlocksResult {
    const threshold = opts.simplifyThreshold ?? ROAD_PERMIT_SYMBOL_SIMPLIFY_THRESHOLD;
    const minLen = opts.minLenMm ?? 30;
    const maxPrims = opts.maxPrimitives ?? ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES;

    const defs = new Map<number, BlockDef>();
    for (const d of doc.block_defs ?? []) defs.set(d.number, d);

    // 図の上（いちばん外）の BLOCK 参照（ブロックごとに最初の 1 つ）と文字
    const firstRef = new Map<number, JwwEntity>();
    const texts: { x: number; y: number; content: string }[] = [];
    for (const e of doc.entities ?? []) {
        if (e.type === 'BLOCK' && typeof e.def_number === 'number' && !firstRef.has(e.def_number)) firstRef.set(e.def_number, e);
        if (e.type === 'TEXT' && typeof e.content === 'string') {
            const content = e.content.trim();
            if (content && !isIgnoredText(content)) texts.push({ x: num(e.start_x, 0), y: num(e.start_y, 0), content });
        }
    }

    const isHidden = hiddenChecker(doc);
    const warnings: string[] = [];
    const notPlaced: string[] = [];
    const blocks: ParsedJwwBlock[] = [];

    for (const def of doc.block_defs ?? []) {
        const rawName = typeof def.name === 'string' ? def.name : '';
        if (isMarkerBlockName(rawName)) continue;
        const name = cleanJwwBlockName(rawName || `ブロック${def.number}`);

        const ctx: CollectContext = { defs, isHidden, aux: 0, hidden: 0, missingDefs: 0 };
        const builder = new GeometryBuilder();
        collect(def.entities ?? [], IDENTITY, 0, ctx, builder);
        let geometry = builder.build();
        if (ctx.aux > 0 || ctx.hidden > 0) {
            warnings.push(`${name}: 補助線 ${ctx.aux} 本・非表示 ${ctx.hidden} 個を除きました`);
        }
        if (symbolPrimitiveCount(geometry) === 0) continue;

        // 実寸にする倍率＝置かれている倍率 × レイヤグループの縮尺
        const ref = firstRef.get(def.number);
        let k = 1;
        if (!ref) {
            notPlaced.push(name);
        } else {
            const raw = Math.abs(num(ref.scale_x, 1) * groupScale(doc, ref.base?.layer_group ?? 0));
            k = raw > EPS && !isOne(raw) ? raw : 1;
            if (k !== 1) {
                geometry = scaleSymbolGeometry(geometry, k);
                warnings.push(`${name}: 倍率 ${Math.round(k * 1e6) / 1e6} を掛けました`);
            }
        }

        // 図の上での形の中心（用紙 mm）＝名前の候補を探す基準。中心をそろえる前に測る
        const localBB = symbolBBox(builder.build());
        const localCenter = { x: (localBB.minX + localBB.maxX) / 2, y: (localBB.minY + localBB.maxY) / 2 };

        let centered = centerSymbolGeometry(geometry);
        const before = symbolPrimitiveCount(centered.geometry);
        let simplified: ParsedJwwBlock['simplified'] = null;
        if (before > threshold) {
            let g = simplifySymbolGeometry(centered.geometry, minLen);
            if (symbolPrimitiveCount(g) > maxPrims) {
                g = capGeometry(g, maxPrims);
                warnings.push(`${name}: 線が多いので、短い線から省いて ${maxPrims.toLocaleString('ja-JP')} 本に収めました`);
            }
            centered = centerSymbolGeometry(g);
            simplified = { before, after: symbolPrimitiveCount(centered.geometry) };
        }

        // 近くの文字（名前の候補）
        let nearbyTexts: string[] = [];
        if (ref) {
            const sx = Math.abs(num(ref.scale_x, 1));
            const m = blockRefAffine(ref);
            const [px, py] = apply(m, localCenter.x, localCenter.y);
            // 用紙の上の大きさ＝実寸 ÷ k × 置かれている倍率
            const R = (Math.max(centered.lengthMm, centered.widthMm) / k) * sx * 1.5 + 20;
            nearbyTexts = texts
                .map((t) => ({ t, d: Math.hypot(t.x - px, t.y - py) }))
                .filter((x) => x.d <= R)
                .sort((a, b) => a.d - b.d)
                .map((x) => x.t.content)
                .filter((c, i, arr) => arr.indexOf(c) === i)
                .slice(0, 3);
        }

        blocks.push({
            key: String(def.number),
            name,
            rawName,
            geometry: roundSymbolGeometry(centered.geometry),
            lengthMm: centered.lengthMm,
            widthMm: centered.widthMm,
            primitiveCount: symbolPrimitiveCount(centered.geometry),
            scaleApplied: k,
            simplified,
            nearbyTexts,
        });
    }

    if (notPlaced.length > 0) {
        const shown = notPlaced.slice(0, 5).join('、');
        const more = notPlaced.length > 5 ? ` ほか ${notPlaced.length - 5} 個` : '';
        warnings.push(`${shown}${more} は図の上に置かれていないので倍率 1 のまま`);
    }

    return { blocks, warnings };
}
