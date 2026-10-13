/**
 * 図面データの既定値と、DB の JSON の正規化（純粋関数）。
 * DB から読んだら必ず normalizeRoadPermitDrawing を通す（欠けた欄・壊れた図形があっても画面が落ちない）。
 */
import type {
    DimensionMode,
    DrawingEntity,
    DrawingLayer,
    DrawingLayerId,
    DrawingPoint,
    DrawingScale,
    DrawingStyle,
    DrawingTitleBlock,
    HatchPattern,
    LineType,
    LineWidth,
    PaperOrientation,
    PaperSize,
    RoadPermitDrawing,
    TextAlign,
} from '@/types/roadPermitDrawing';
import { DRAWING_SCALES, DRAWING_VERSION } from '@/types/roadPermitDrawing';

/** レイヤの名前（固定・設計書 §6.5） */
export const DRAWING_LAYER_NAMES: Record<DrawingLayerId, string> = {
    0: '道路・境界',
    1: '建物・敷地',
    2: '足場・養生',
    3: '保安施設',
    4: '車両',
    5: '寸法・文字',
    6: '下敷き',
};

/** レイヤの画面上の色（印刷は黒。画面で見分けるための色） */
export const DRAWING_LAYER_COLORS: Record<DrawingLayerId, string> = {
    0: '#334155',
    1: '#1d4ed8',
    2: '#15803d',
    3: '#ea580c',
    4: '#7e22ce',
    5: '#0f766e',
    6: '#94a3b8',
};

export const DRAWING_LAYER_IDS: readonly DrawingLayerId[] = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_STYLE: DrawingStyle = { lineType: 'solid', width: 'normal', color: '#000000' };
export const DEFAULT_TEXT_HEIGHT_PAPER_MM = 3;
export const DEFAULT_DIMENSION_TEXT_HEIGHT_PAPER_MM = 2.5;
export const DEFAULT_HATCH_SPACING_PAPER_MM = 2;
/** 占用範囲を描くときの書込レイヤの既定（2 足場・養生） */
export const OCCUPANCY_DEFAULT_LAYER: DrawingLayerId = 2;
/** 占用範囲の斜線の間隔（用紙上 mm・PDF） */
export const OCCUPANCY_HATCH_SPACING_PAPER_MM = 3;
export const DEFAULT_SCALE: DrawingScale = 100;
export const DEFAULT_PAPER: { size: PaperSize; orientation: PaperOrientation } = { size: 'A3', orientation: 'landscape' };

export function defaultLayers(): DrawingLayer[] {
    return DRAWING_LAYER_IDS.map((id) => ({
        id,
        name: DRAWING_LAYER_NAMES[id],
        visible: true,
        locked: false,
        // 下敷き（6）は印刷しない
        printable: id !== 6,
    }));
}

export function emptyTitleBlock(): DrawingTitleBlock {
    return { drawingName: '', location: '', routeName: '', period: '', author: '' };
}

export function emptyRoadPermitDrawing(): RoadPermitDrawing {
    return {
        version: DRAWING_VERSION,
        paper: { ...DEFAULT_PAPER },
        scale: DEFAULT_SCALE,
        origin: { x: 0, y: 0 },
        layers: defaultLayers(),
        currentLayer: 0,
        entities: [],
        titleBlock: emptyTitleBlock(),
        showTitleBlock: true,
        showNorthArrow: true,
        showScaleBar: true,
        showLegend: true,
    };
}

/** 図形が 1 つも無い（PDF に図面を入れるかの判定に使う） */
export function isDrawingEmpty(d: RoadPermitDrawing | null | undefined): boolean {
    return !d || d.entities.length === 0;
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

const LINE_TYPES: readonly LineType[] = ['solid', 'dashed', 'dashdot', 'dotted'];
const LINE_WIDTHS: readonly LineWidth[] = ['thin', 'normal', 'thick'];
const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];
const DIM_MODES: readonly DimensionMode[] = ['aligned', 'horizontal', 'vertical'];
const HATCH_PATTERNS: readonly HatchPattern[] = ['diagonal', 'cross', 'solid'];

function point(v: unknown): DrawingPoint | null {
    const o = obj(v);
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
    return { x: o.x, y: o.y };
}

function points(v: unknown): DrawingPoint[] {
    if (!Array.isArray(v)) return [];
    const out: DrawingPoint[] = [];
    for (const item of v) {
        const p = point(item);
        if (p) out.push(p);
    }
    return out;
}

function style(v: unknown): DrawingStyle {
    const o = obj(v);
    const color = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : DEFAULT_STYLE.color;
    return {
        lineType: oneOf(o.lineType, LINE_TYPES, DEFAULT_STYLE.lineType),
        width: oneOf(o.width, LINE_WIDTHS, DEFAULT_STYLE.width),
        color,
    };
}

function layerId(v: unknown): DrawingLayerId {
    return oneOf(v, DRAWING_LAYER_IDS, 0);
}

let seq = 0;
/** 図形の id（画面側は crypto.randomUUID があればそれを使ってよい） */
export function newEntityId(): string {
    seq += 1;
    return `e${Date.now().toString(36)}${seq.toString(36)}`;
}

/** 図形 1 つの正規化。形が壊れていれば null（落とす） */
export function normalizeEntity(raw: unknown): DrawingEntity | null {
    const o = obj(raw);
    const base = { id: str(o.id) || newEntityId(), layer: layerId(o.layer), style: style(o.style) };
    switch (o.kind) {
        case 'line': {
            const a = point(o.a);
            const b = point(o.b);
            return a && b ? { ...base, kind: 'line', a, b } : null;
        }
        case 'polyline': {
            const pts = points(o.points);
            return pts.length >= 2 ? { ...base, kind: 'polyline', points: pts, closed: bool(o.closed, false) } : null;
        }
        case 'circle': {
            const center = point(o.center);
            const r = num(o.r, 0);
            return center && r > 0 ? { ...base, kind: 'circle', center, r } : null;
        }
        case 'arc': {
            const center = point(o.center);
            const r = num(o.r, 0);
            return center && r > 0
                ? { ...base, kind: 'arc', center, r, startDeg: num(o.startDeg, 0), endDeg: num(o.endDeg, 90) }
                : null;
        }
        case 'text': {
            const at = point(o.at);
            return at
                ? {
                      ...base,
                      kind: 'text',
                      at,
                      text: str(o.text),
                      heightPaperMm: Math.max(0.5, num(o.heightPaperMm, DEFAULT_TEXT_HEIGHT_PAPER_MM)),
                      rotationDeg: num(o.rotationDeg, 0),
                      align: oneOf(o.align, ALIGNS, 'left'),
                  }
                : null;
        }
        case 'dimension': {
            const a = point(o.a);
            const b = point(o.b);
            return a && b
                ? {
                      ...base,
                      kind: 'dimension',
                      a,
                      b,
                      offsetMm: num(o.offsetMm, 0),
                      mode: oneOf(o.mode, DIM_MODES, 'aligned'),
                      textOverride: typeof o.textOverride === 'string' ? o.textOverride : null,
                      heightPaperMm: Math.max(0.5, num(o.heightPaperMm, DEFAULT_DIMENSION_TEXT_HEIGHT_PAPER_MM)),
                  }
                : null;
        }
        case 'leader': {
            const pts = points(o.points);
            return pts.length >= 2
                ? {
                      ...base,
                      kind: 'leader',
                      points: pts,
                      text: str(o.text),
                      heightPaperMm: Math.max(0.5, num(o.heightPaperMm, DEFAULT_TEXT_HEIGHT_PAPER_MM)),
                  }
                : null;
        }
        case 'hatch': {
            const pts = points(o.points);
            return pts.length >= 3
                ? {
                      ...base,
                      kind: 'hatch',
                      points: pts,
                      pattern: oneOf(o.pattern, HATCH_PATTERNS, 'diagonal'),
                      spacingPaperMm: Math.max(0.2, num(o.spacingPaperMm, DEFAULT_HATCH_SPACING_PAPER_MM)),
                  }
                : null;
        }
        case 'symbol': {
            const at = point(o.at);
            const symbolId = str(o.symbolId);
            return at && symbolId
                ? { ...base, kind: 'symbol', symbolId, at, rotationDeg: num(o.rotationDeg, 0), mirrored: bool(o.mirrored, false) }
                : null;
        }
        case 'occupancy': {
            const pts = points(o.points);
            // 閉じる点（最初と同じ点）が最後に重なっていたら外す
            if (pts.length >= 4) {
                const f = pts[0];
                const l = pts[pts.length - 1];
                if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) pts.pop();
            }
            return pts.length >= 3 ? { ...base, kind: 'occupancy', points: pts, routeName: str(o.routeName).slice(0, 100) } : null;
        }
        default:
            return null;
    }
}

export function normalizeRoadPermitDrawing(raw: unknown): RoadPermitDrawing {
    const o = obj(raw);
    const base = emptyRoadPermitDrawing();
    const paper = obj(o.paper);
    const layersRaw = Array.isArray(o.layers) ? o.layers : [];
    const byId = new Map<DrawingLayerId, Record<string, unknown>>();
    for (const l of layersRaw) {
        const lo = obj(l);
        if ((DRAWING_LAYER_IDS as readonly unknown[]).includes(lo.id)) byId.set(lo.id as DrawingLayerId, lo);
    }
    const layers: DrawingLayer[] = base.layers.map((def) => {
        const lo = byId.get(def.id);
        if (!lo) return def;
        return { ...def, visible: bool(lo.visible, def.visible), locked: bool(lo.locked, def.locked), printable: bool(lo.printable, def.printable) };
    });
    const entitiesRaw = Array.isArray(o.entities) ? o.entities : [];
    const entities: DrawingEntity[] = [];
    const seen = new Set<string>();
    for (const e of entitiesRaw) {
        const n = normalizeEntity(e);
        if (!n) continue;
        if (seen.has(n.id)) n.id = newEntityId();
        seen.add(n.id);
        entities.push(n);
    }
    const tb = obj(o.titleBlock);
    return {
        version: DRAWING_VERSION,
        paper: {
            size: oneOf(paper.size, ['A4', 'A3'] as const, base.paper.size),
            orientation: oneOf(paper.orientation, ['landscape', 'portrait'] as const, base.paper.orientation),
        },
        scale: oneOf(o.scale, DRAWING_SCALES, base.scale),
        origin: point(o.origin) ?? base.origin,
        layers,
        currentLayer: layerId(o.currentLayer),
        entities,
        titleBlock: {
            drawingName: str(tb.drawingName),
            location: str(tb.location),
            routeName: str(tb.routeName),
            period: str(tb.period),
            author: str(tb.author),
        },
        showTitleBlock: bool(o.showTitleBlock, true),
        showNorthArrow: bool(o.showNorthArrow, true),
        showScaleBar: bool(o.showScaleBar, true),
        showLegend: bool(o.showLegend, true),
    };
}
