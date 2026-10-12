/**
 * 作図画面（JWW 風）の「画面の状態と操作」。純粋関数（reducer）だけで書く。
 * konva にも React にも依存しない＝テストしやすく、画面（DrawingEditor / DrawingCanvas）は
 * ここの状態を描いて、マウスやキーの出来事を action にして渡すだけにする。
 *
 * 決まり（docs/指示書_道路申請_Phase2.md §2）
 * - 操作の順は JWW と同じ「コマンドを選ぶ → 点を指示」。直す系は「選ぶ → 操作」
 * - 図形の追加／変更／削除のたびに履歴を積む（50 回まで）。履歴は図形の並びだけを持つ
 *   （レイヤの表示や用紙の設定は戻る／進むの対象にしない＝戻るで表示が勝手に変わらないように）
 * - 点は実寸 mm・Y 上向き。画面の px との変換は realToScreen / screenToReal
 */
import type {
    DimensionMode,
    DrawingEntity,
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
} from '@/types/roadPermitDrawing';
import type { RoadPermitValues } from '@/types/roadPermit';
import { drawingPaperMm, fromPaper, toPaper } from '@/lib/roadPermit/drawing/paper';
import {
    add,
    angleDeg,
    circlePoints,
    distance,
    doubleLine,
    entitiesInRect,
    mirrorEntity,
    mm2ToM2,
    orthoSnap,
    pickEntity,
    polar,
    polygonArea,
    rotateEntity,
    scaleVec,
    sub,
    translateEntity,
    unit,
    perpendicularUnit,
    type BBox,
} from '@/lib/roadPermit/drawing/geometry';
import {
    DEFAULT_DIMENSION_TEXT_HEIGHT_PAPER_MM,
    DEFAULT_HATCH_SPACING_PAPER_MM,
    DEFAULT_TEXT_HEIGHT_PAPER_MM,
    newEntityId,
} from '@/lib/roadPermit/drawing/defaults';
import { formatReiwaRange } from '@/lib/roadPermit/format';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type CommandId =
    | 'select'
    | 'line'
    | 'polyline'
    | 'rect'
    | 'circle'
    | 'arc'
    | 'double'
    | 'text'
    | 'dimension'
    | 'leader'
    | 'hatch'
    | 'erase'
    | 'copy'
    | 'move'
    | 'rotate'
    | 'mirror'
    | 'attr'
    | 'measureDistance'
    | 'measureArea';

/** 画面のボタン名（画面イメージの言葉） */
export const COMMAND_LABELS: Record<CommandId, string> = {
    select: '範囲',
    line: '線',
    polyline: '連続線',
    rect: '矩形',
    circle: '円',
    arc: '円弧',
    double: '2線',
    text: '文字',
    dimension: '寸法',
    leader: '引出線',
    hatch: 'ハッチ',
    erase: '消去',
    copy: '複写',
    move: '移動',
    rotate: '回転',
    mirror: '反転',
    attr: '属性',
    measureDistance: '距離',
    measureArea: '面積',
};

export const DRAW_COMMANDS: readonly CommandId[] = ['line', 'polyline', 'rect', 'circle', 'arc', 'double', 'text', 'dimension', 'leader', 'hatch'];
export const EDIT_COMMANDS: readonly CommandId[] = ['select', 'erase', 'copy', 'move', 'rotate', 'mirror', 'attr'];
export const MEASURE_COMMANDS: readonly CommandId[] = ['measureDistance', 'measureArea'];

/** 選んでから点を指示する操作 */
const TRANSFORM_COMMANDS: readonly CommandId[] = ['copy', 'move', 'rotate', 'mirror'];

/** 寸法の向き（連続＝点を続けて指示して 1 本の寸法線に並べる） */
export type DimensionToolMode = 'horizontal' | 'vertical' | 'aligned' | 'chain';

export const DIMENSION_TOOL_LABELS: Record<DimensionToolMode, string> = {
    horizontal: '水平',
    vertical: '垂直',
    aligned: '斜め',
    chain: '連続',
};

/** コントロールバーの値。数値の欄は入力途中の文字をそのまま持つ（'' ＝ 指定なし） */
export interface ToolSettings {
    /** 長さ（mm）。線・連続線・2線・移動・複写の終点、円の半径 */
    length: string;
    /** 角度（度・反時計回り）。線の向き・文字の向き・回転の角度 */
    angle: string;
    /** 2線の幅（mm） */
    doubleWidth: string;
    lineType: LineType;
    lineWidth: LineWidth;
    /** 文字の大きさ（用紙上の mm） */
    textHeight: number;
    /** 寸法の文字の大きさ（用紙上の mm） */
    dimTextHeight: number;
    dimMode: DimensionToolMode;
    hatchPattern: HatchPattern;
}

export interface ViewState {
    /** 用紙 1mm が画面で何 px か */
    pxPerMm: number;
    /** 用紙の左上隅の画面位置（px） */
    panX: number;
    panY: number;
    showGrid: boolean;
    showPaperFrame: boolean;
    /** 画面の大きさに合わせて最初の表示を決めたか */
    initialized: boolean;
}

/** 文字を入れる小さなポップアップ */
export type PromptState =
    | { kind: 'text'; anchor: DrawingPoint; initial: string }
    | { kind: 'leader'; anchor: DrawingPoint; points: DrawingPoint[]; initial: string }
    | { kind: 'edit'; anchor: DrawingPoint; entityId: string; initial: string };

export interface EditorState {
    drawing: RoadPermitDrawing;
    selection: string[];
    command: CommandId;
    /** 直す系の段階: 'select' ＝ 図形を選んでいるところ／'points' ＝ 点を指示するところ */
    phase: 'select' | 'points';
    /** いまのコマンドで指示済みの点 */
    pts: DrawingPoint[];
    /** 連続寸法の寸法線の位置（水平なら y・垂直なら x・斜めなら offset） */
    chain: { mode: DimensionMode; line: number } | null;
    past: DrawingEntity[][];
    future: DrawingEntity[][];
    view: ViewState;
    settings: ToolSettings;
    prompt: PromptState | null;
    /** ステータスバーに出す結果・注意（測った長さなど） */
    message: string | null;
    /** カーソルの位置（実寸）。ゴム線と座標の表示に使う */
    cursor: DrawingPoint | null;
    cursorShift: boolean;
}

export type EditorAction =
    | { type: 'point'; p: DrawingPoint; snapped?: boolean; shift?: boolean; tolMm: number; additive?: boolean }
    | { type: 'rectSelect'; rect: BBox; additive?: boolean }
    | { type: 'numeric' }
    | { type: 'esc' }
    | { type: 'finish' }
    | { type: 'command'; command: CommandId }
    | { type: 'clearSelection' }
    | { type: 'deleteSelection' }
    | { type: 'applyAttributes'; patch: AttributePatch }
    | { type: 'editSelectedText' }
    | { type: 'promptSubmit'; text: string }
    | { type: 'promptCancel' }
    | { type: 'setLayer'; id: DrawingLayerId; patch: { visible?: boolean; locked?: boolean; printable?: boolean } }
    | { type: 'setCurrentLayer'; id: DrawingLayerId }
    | { type: 'setSettings'; patch: Partial<ToolSettings> }
    | { type: 'setPaper'; size?: PaperSize; orientation?: PaperOrientation }
    | { type: 'setScale'; scale: DrawingScale }
    | { type: 'setOrigin'; origin: DrawingPoint }
    | { type: 'setDrawingFlags'; patch: Partial<Pick<RoadPermitDrawing, 'showTitleBlock' | 'showNorthArrow' | 'showScaleBar'>> }
    | { type: 'setTitleBlock'; patch: Partial<DrawingTitleBlock> }
    | { type: 'setView'; patch: Partial<ViewState> }
    | { type: 'hover'; p: DrawingPoint | null; shift?: boolean }
    | { type: 'setMessage'; message: string | null }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'replaceDrawing'; drawing: RoadPermitDrawing };

export interface AttributePatch {
    layer?: DrawingLayerId;
    lineType?: LineType;
    width?: LineWidth;
    /** 文字・寸法・引出線の文字の大きさ */
    heightPaperMm?: number;
}

export const HISTORY_LIMIT = 50;
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// 初期状態
// ---------------------------------------------------------------------------

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
    length: '',
    angle: '',
    doubleWidth: '6000',
    lineType: 'solid',
    lineWidth: 'normal',
    textHeight: DEFAULT_TEXT_HEIGHT_PAPER_MM,
    dimTextHeight: DEFAULT_DIMENSION_TEXT_HEIGHT_PAPER_MM,
    dimMode: 'horizontal',
    hatchPattern: 'diagonal',
};

export function initialEditorState(drawing: RoadPermitDrawing): EditorState {
    return {
        drawing,
        selection: [],
        command: 'line',
        phase: 'points',
        pts: [],
        chain: null,
        past: [],
        future: [],
        view: { pxPerMm: 2, panX: 20, panY: 20, showGrid: true, showPaperFrame: true, initialized: false },
        settings: { ...DEFAULT_TOOL_SETTINGS },
        prompt: null,
        message: null,
        cursor: null,
        cursorShift: false,
    };
}

// ---------------------------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------------------------

/** コントロールバーの数値（'' や読めない文字は null） */
export function parseNum(v: string): number | null {
    const t = v.trim().replace(/,/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

function currentStyle(s: EditorState): DrawingStyle {
    return { lineType: s.settings.lineType, width: s.settings.lineWidth, color: '#000000' };
}

function base(s: EditorState) {
    return { id: newEntityId(), layer: s.drawing.currentLayer, style: currentStyle(s) };
}

/** 選んだり消したりできる図形（表示中・ロックしていないレイヤ） */
export function pickableEntities(d: RoadPermitDrawing): DrawingEntity[] {
    const ok = new Set(d.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
    return d.entities.filter((e) => ok.has(e.layer));
}

/** 表示中のレイヤの図形（読取点の候補・描画に使う） */
export function visibleEntities(d: RoadPermitDrawing): DrawingEntity[] {
    const ok = new Set(d.layers.filter((l) => l.visible).map((l) => l.id));
    return d.entities.filter((e) => ok.has(e.layer));
}

/** 図形を変えて履歴を積む */
function commitEntities(s: EditorState, entities: DrawingEntity[], patch: Partial<EditorState> = {}): EditorState {
    const ids = new Set(entities.map((e) => e.id));
    return {
        ...s,
        drawing: { ...s.drawing, entities },
        past: [...s.past, s.drawing.entities].slice(-HISTORY_LIMIT),
        future: [],
        selection: s.selection.filter((id) => ids.has(id)),
        ...patch,
    };
}

function addEntities(s: EditorState, list: DrawingEntity[], patch: Partial<EditorState> = {}): EditorState {
    if (list.length === 0) return { ...s, ...patch };
    return commitEntities(s, [...s.drawing.entities, ...list], patch);
}

/** Shift（水平垂直）・角度・長さの指定で点を直す（読取点はそのまま） */
export function constrainPoint(s: Pick<EditorState, 'settings'>, from: DrawingPoint, p: DrawingPoint, shift: boolean): DrawingPoint {
    const ang = parseNum(s.settings.angle);
    const len = parseNum(s.settings.length);
    let q = p;
    if (ang != null) {
        const dir = polar(1, ang);
        const t = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y;
        q = add(from, scaleVec(dir, t));
    } else if (shift) {
        q = orthoSnap(from, p);
    }
    if (len != null && len > 0) {
        const d = distance(from, q);
        const dir = d < EPS ? (ang != null ? polar(1, ang) : { x: 1, y: 0 }) : unit(from, q);
        q = add(from, scaleVec(dir, len));
    }
    return q;
}

/** その操作で長さ・角度・Shift の指定が効くか */
function usesConstraint(s: EditorState): boolean {
    if (s.pts.length === 0) return false;
    if (s.command === 'line' || s.command === 'polyline' || s.command === 'double') return true;
    if ((s.command === 'move' || s.command === 'copy') && s.phase === 'points') return true;
    return false;
}

function offsetFor(mode: DimensionMode, a: DrawingPoint, b: DrawingPoint, p: DrawingPoint): number {
    if (mode === 'horizontal') return p.y - Math.max(a.y, b.y);
    if (mode === 'vertical') return p.x - Math.max(a.x, b.x);
    const n = perpendicularUnit(a, b);
    return (p.x - a.x) * n.x + (p.y - a.y) * n.y;
}

function chainMode(a: DrawingPoint, b: DrawingPoint): 'horizontal' | 'vertical' {
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
}

/** 連続寸法の寸法線の位置 → その組の offset */
function chainOffset(chain: { mode: DimensionMode; line: number }, a: DrawingPoint, b: DrawingPoint): number {
    if (chain.mode === 'horizontal') return chain.line - Math.max(a.y, b.y);
    if (chain.mode === 'vertical') return chain.line - Math.max(a.x, b.x);
    return chain.line;
}

function makeDimension(s: EditorState, a: DrawingPoint, b: DrawingPoint, mode: DimensionMode, offsetMm: number): DrawingEntity {
    return {
        ...base(s),
        kind: 'dimension',
        a,
        b,
        offsetMm,
        mode,
        textOverride: null,
        heightPaperMm: s.settings.dimTextHeight,
    };
}

/** 閉じた形の点列（ハッチの元にできるもの）。無ければ null */
function closedOutline(e: DrawingEntity): DrawingPoint[] | null {
    if (e.kind === 'polyline' && e.closed && e.points.length >= 3) return e.points;
    if (e.kind === 'polyline' && !e.closed && e.points.length >= 4 && distance(e.points[0], e.points[e.points.length - 1]) < EPS) {
        return e.points.slice(0, -1);
    }
    if (e.kind === 'circle') return circlePoints(e, 48).slice(0, -1);
    return null;
}

function formatM(mm: number): string {
    return (mm / 1000).toLocaleString('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function resetStage(s: EditorState, patch: Partial<EditorState> = {}): EditorState {
    return { ...s, pts: [], chain: null, prompt: null, ...patch };
}

// ---------------------------------------------------------------------------
// 点の指示
// ---------------------------------------------------------------------------

function pickAt(s: EditorState, p: DrawingPoint, tolMm: number): DrawingEntity | null {
    return pickEntity(p, pickableEntities(s.drawing), tolMm);
}

/** クリックで選ぶ（追加＝Shift／Ctrl なら足す・同じものなら外す） */
function selectByClick(s: EditorState, p: DrawingPoint, tolMm: number, additive: boolean, toggle: boolean): EditorState {
    const hit = pickAt(s, p, tolMm);
    if (!hit) return additive || toggle ? s : { ...s, selection: [] };
    if (toggle || additive) {
        const has = s.selection.includes(hit.id);
        return { ...s, selection: has ? s.selection.filter((id) => id !== hit.id) : [...s.selection, hit.id] };
    }
    return { ...s, selection: [hit.id] };
}

function handlePoint(s: EditorState, a: Extract<EditorAction, { type: 'point' }>): EditorState {
    if (s.prompt) return s; // 文字の入力中は点を受けない
    const raw = a.p;
    const p = usesConstraint(s) && !a.snapped ? constrainPoint(s, s.pts[s.pts.length - 1], raw, !!a.shift) : raw;
    const st: EditorState = { ...s, message: null };

    switch (s.command) {
        case 'select':
            return selectByClick(st, raw, a.tolMm, !!a.additive, false);

        case 'attr':
            return selectByClick(st, raw, a.tolMm, !!a.additive, false);

        case 'erase': {
            const hit = pickAt(st, raw, a.tolMm);
            if (!hit) return { ...st, message: '図形がありません' };
            return commitEntities(st, st.drawing.entities.filter((e) => e.id !== hit.id));
        }

        case 'copy':
        case 'move':
        case 'rotate':
        case 'mirror': {
            if (st.phase === 'select') return selectByClick(st, raw, a.tolMm, true, true);
            return transformPoint(st, p);
        }

        case 'line': {
            if (st.pts.length === 0) return { ...st, pts: [p] };
            const from = st.pts[0];
            if (distance(from, p) < EPS) return st;
            return addEntities(st, [{ ...base(st), kind: 'line', a: from, b: p }], { pts: [] });
        }

        case 'polyline': {
            const pts = st.pts;
            if (pts.length > 0 && distance(pts[pts.length - 1], p) < EPS) return st;
            if (pts.length >= 3 && distance(pts[0], p) < EPS) {
                return addEntities(st, [{ ...base(st), kind: 'polyline', points: pts, closed: true }], { pts: [] });
            }
            return { ...st, pts: [...pts, p] };
        }

        case 'rect': {
            if (st.pts.length === 0) return { ...st, pts: [p] };
            const c = st.pts[0];
            if (Math.abs(p.x - c.x) < EPS || Math.abs(p.y - c.y) < EPS) return st;
            const points = [c, { x: p.x, y: c.y }, p, { x: c.x, y: p.y }];
            return addEntities(st, [{ ...base(st), kind: 'polyline', points, closed: true }], { pts: [] });
        }

        case 'circle': {
            if (st.pts.length === 0) return { ...st, pts: [p] };
            const r = distance(st.pts[0], p);
            if (r < EPS) return st;
            return addEntities(st, [{ ...base(st), kind: 'circle', center: st.pts[0], r }], { pts: [] });
        }

        case 'arc': {
            if (st.pts.length < 2) {
                if (st.pts.length === 1 && distance(st.pts[0], p) < EPS) return st;
                return { ...st, pts: [...st.pts, p] };
            }
            const [center, startP] = st.pts;
            const r = distance(center, startP);
            const startDeg = angleDeg(center, startP);
            let endDeg = angleDeg(center, p);
            if (Math.abs(endDeg - startDeg) < EPS) return st;
            if (endDeg < startDeg) endDeg += 360;
            return addEntities(st, [{ ...base(st), kind: 'arc', center, r, startDeg, endDeg }], { pts: [] });
        }

        case 'double': {
            const w = parseNum(st.settings.doubleWidth);
            if (w == null || w <= 0) return { ...st, message: '2線の幅（mm）を入れてください' };
            if (st.pts.length === 0) return { ...st, pts: [p] };
            const from = st.pts[0];
            if (distance(from, p) < EPS) return st;
            const { left, right } = doubleLine(from, p, w);
            return addEntities(
                st,
                [
                    { ...base(st), kind: 'line', a: left[0], b: left[1] },
                    { ...base(st), kind: 'line', a: right[0], b: right[1] },
                ],
                { pts: [] },
            );
        }

        case 'text':
            return { ...st, prompt: { kind: 'text', anchor: p, initial: '' } };

        case 'leader': {
            if (st.pts.length === 0) return { ...st, pts: [p] };
            if (distance(st.pts[0], p) < EPS) return st;
            const points = [st.pts[0], p];
            return { ...st, pts: points, prompt: { kind: 'leader', anchor: p, points, initial: '' } };
        }

        case 'dimension':
            return dimensionPoint(st, p);

        case 'hatch': {
            const candidates = pickableEntities(st.drawing).filter((e) => closedOutline(e) != null);
            const hit = pickEntity(raw, candidates, Math.max(a.tolMm, 0));
            const inside = hit ?? candidates.find((e) => pointInOutline(raw, closedOutline(e)!)) ?? null;
            if (!inside) return { ...st, message: '閉じた連続線か矩形をクリックしてください' };
            return addEntities(st, [
                {
                    ...base(st),
                    kind: 'hatch',
                    points: closedOutline(inside)!,
                    pattern: st.settings.hatchPattern,
                    spacingPaperMm: DEFAULT_HATCH_SPACING_PAPER_MM,
                },
            ]);
        }

        case 'measureDistance': {
            if (st.pts.length === 0) return { ...st, pts: [p] };
            const d = distance(st.pts[0], p);
            return { ...st, pts: [], message: `距離 ${formatM(d)} m（${Math.round(d).toLocaleString('ja-JP')} mm）` };
        }

        case 'measureArea':
            return { ...st, pts: [...st.pts, p] };
    }
}

function pointInOutline(p: DrawingPoint, poly: DrawingPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function dimensionPoint(s: EditorState, p: DrawingPoint): EditorState {
    const mode = s.settings.dimMode;
    if (mode !== 'chain') {
        if (s.pts.length < 2) {
            if (s.pts.length === 1 && distance(s.pts[0], p) < EPS) return s;
            return { ...s, pts: [...s.pts, p] };
        }
        const [a, b] = s.pts;
        return addEntities(s, [makeDimension(s, a, b, mode, offsetFor(mode, a, b, p))], { pts: [] });
    }
    // 連続寸法: 1 点目 → 2 点目 → 寸法線の位置 → あとは点を続けるたびに 1 本ずつ
    if (!s.chain) {
        if (s.pts.length < 2) {
            if (s.pts.length === 1 && distance(s.pts[0], p) < EPS) return s;
            return { ...s, pts: [...s.pts, p] };
        }
        const [a, b] = s.pts;
        const m = chainMode(a, b);
        const chain = { mode: m as DimensionMode, line: m === 'horizontal' ? p.y : p.x };
        return addEntities(s, [makeDimension(s, a, b, m, chainOffset(chain, a, b))], { pts: [b], chain });
    }
    const prev = s.pts[s.pts.length - 1];
    if (distance(prev, p) < EPS) return s;
    return addEntities(s, [makeDimension(s, prev, p, s.chain.mode, chainOffset(s.chain, prev, p))], { pts: [p] });
}

function selectedEntities(s: EditorState): DrawingEntity[] {
    const set = new Set(s.selection);
    return s.drawing.entities.filter((e) => set.has(e.id));
}

/** 移動・複写・回転・反転で、選んだ図形をどう変えるか（プレビューと確定で共通） */
function transformed(s: EditorState, p: DrawingPoint, forPreview: boolean): DrawingEntity[] | null {
    const sel = selectedEntities(s);
    if (sel.length === 0) return null;
    const basePt = s.pts[0];
    switch (s.command) {
        case 'move':
        case 'copy':
            if (!basePt) return null;
            return sel.map((e) => translateEntity(e, sub(p, basePt)));
        case 'rotate': {
            const fixed = parseNum(s.settings.angle);
            if (!basePt) return fixed != null && forPreview ? sel.map((e) => rotateEntity(e, p, fixed)) : null;
            return sel.map((e) => rotateEntity(e, basePt, angleDeg(basePt, p)));
        }
        case 'mirror':
            if (!basePt || distance(basePt, p) < EPS) return null;
            return sel.map((e) => mirrorEntity(e, basePt, p));
        default:
            return null;
    }
}

function transformPoint(s: EditorState, p: DrawingPoint): EditorState {
    if (s.selection.length === 0) return { ...s, phase: 'select', pts: [], message: '先に図形を選んでください' };
    const sel = selectedEntities(s);
    if (s.command === 'rotate' && s.pts.length === 0) {
        const fixed = parseNum(s.settings.angle);
        if (fixed == null) return { ...s, pts: [p] };
        const rotated = new Map(sel.map((e) => [e.id, rotateEntity(e, p, fixed)]));
        return commitEntities(s, s.drawing.entities.map((e) => rotated.get(e.id) ?? e));
    }
    if (s.pts.length === 0) return { ...s, pts: [p] };
    const next = transformed(s, p, false);
    if (!next) return s;
    if (s.command === 'copy') {
        // 複写: 同じ基点から何回でも置ける（Esc で終わり）
        const copies = next.map((e) => ({ ...e, id: newEntityId() }));
        return addEntities(s, copies);
    }
    const map = new Map(next.map((e) => [e.id, e]));
    return commitEntities(s, s.drawing.entities.map((e) => map.get(e.id) ?? e), { pts: [] });
}

// ---------------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------------

function startCommand(s: EditorState, command: CommandId): EditorState {
    const st = resetStage(s, { command, message: null });
    if (command === 'erase') {
        if (s.selection.length > 0) {
            const set = new Set(s.selection);
            return commitEntities(st, s.drawing.entities.filter((e) => !set.has(e.id)), { selection: [] });
        }
        return { ...st, phase: 'points' };
    }
    if (TRANSFORM_COMMANDS.includes(command)) return { ...st, phase: s.selection.length > 0 ? 'points' : 'select' };
    if (command === 'select' || command === 'attr') return { ...st, phase: 'select' };
    // 描く・測る は選択を外す（JWW と同じ）
    return { ...st, phase: 'points', selection: [] };
}

function finish(s: EditorState): EditorState {
    if (s.prompt) return s;
    switch (s.command) {
        case 'polyline':
            if (s.pts.length >= 2) return addEntities(s, [{ ...base(s), kind: 'polyline', points: s.pts, closed: false }], { pts: [] });
            return resetStage(s);
        case 'measureArea': {
            if (s.pts.length < 3) return resetStage(s, { message: s.pts.length > 0 ? '面積は 3 点以上を指示してください' : s.message });
            const m2 = mm2ToM2(polygonArea(s.pts));
            return resetStage(s, { message: `面積 ${m2.toLocaleString('ja-JP', { maximumFractionDigits: 3 })} ㎡` });
        }
        case 'copy':
        case 'move':
        case 'rotate':
        case 'mirror':
            if (s.phase === 'select') {
                if (s.selection.length === 0) return { ...s, message: '先に図形を選んでください' };
                return { ...s, phase: 'points', pts: [], message: null };
            }
            return resetStage(s);
        default:
            return resetStage(s);
    }
}

function esc(s: EditorState): EditorState {
    if (s.prompt) return resetStage(s);
    if (s.command === 'polyline' || s.command === 'measureArea') {
        if (s.pts.length > 0) return finish(s);
    }
    if (s.pts.length > 0 || s.chain) return resetStage(s);
    if (TRANSFORM_COMMANDS.includes(s.command) && s.phase === 'points') return { ...s, phase: 'select', selection: [] };
    if (s.selection.length > 0) return { ...s, selection: [] };
    return { ...s, message: null };
}

function numeric(s: EditorState): EditorState {
    const len = parseNum(s.settings.length);
    const ang = parseNum(s.settings.angle) ?? 0;
    if (s.command === 'circle' && s.pts.length === 1) {
        if (len == null || len <= 0) return { ...s, message: '半径（長さ）を入れてください' };
        return addEntities(s, [{ ...base(s), kind: 'circle', center: s.pts[0], r: len }], { pts: [] });
    }
    if (s.command === 'rotate' && s.phase === 'points' && s.pts.length === 1 && parseNum(s.settings.angle) != null) {
        return transformPoint({ ...s, pts: [] }, s.pts[0]);
    }
    if (len == null || len <= 0 || s.pts.length === 0) return s;
    if (!usesConstraint(s)) return s;
    const from = s.pts[s.pts.length - 1];
    const p = add(from, polar(len, ang));
    return handlePoint(s, { type: 'point', p, snapped: true, tolMm: 0 });
}

/** 縮尺・用紙を変えるとき、用紙の真ん中に来ている図面の位置を変えない（図形の実寸は変えない） */
function keepCenter(d: RoadPermitDrawing, next: Pick<RoadPermitDrawing, 'scale' | 'paper'>): DrawingPoint {
    const cur = drawingPaperMm(d);
    const center = fromPaper({ x: cur.w / 2, y: cur.h / 2 }, d);
    const nw = drawingPaperMm(next);
    return { x: center.x - (nw.w / 2) * next.scale, y: center.y - (nw.h / 2) * next.scale };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
    switch (a.type) {
        case 'point':
            return handlePoint(s, a);
        case 'rectSelect': {
            const hits = entitiesInRect(a.rect, pickableEntities(s.drawing)).map((e) => e.id);
            if (s.command === 'erase') {
                if (hits.length === 0) return s;
                const set = new Set(hits);
                return commitEntities(s, s.drawing.entities.filter((e) => !set.has(e.id)));
            }
            const sel = a.additive || (TRANSFORM_COMMANDS.includes(s.command) && s.phase === 'select')
                ? Array.from(new Set([...s.selection, ...hits]))
                : hits;
            return { ...s, selection: sel, message: null };
        }
        case 'numeric':
            return numeric(s);
        case 'esc':
            return esc(s);
        case 'finish':
            return finish(s);
        case 'command':
            return startCommand(s, a.command);
        case 'clearSelection':
            return { ...s, selection: [] };
        case 'deleteSelection': {
            if (s.selection.length === 0) return s;
            const set = new Set(s.selection);
            return commitEntities(s, s.drawing.entities.filter((e) => !set.has(e.id)), { selection: [] });
        }
        case 'applyAttributes': {
            if (s.selection.length === 0) return s;
            const set = new Set(s.selection);
            const { patch } = a;
            const entities = s.drawing.entities.map((e): DrawingEntity => {
                if (!set.has(e.id)) return e;
                let n: DrawingEntity = {
                    ...e,
                    layer: patch.layer ?? e.layer,
                    style: { ...e.style, lineType: patch.lineType ?? e.style.lineType, width: patch.width ?? e.style.width },
                };
                if (patch.heightPaperMm != null && (n.kind === 'text' || n.kind === 'dimension' || n.kind === 'leader')) {
                    n = { ...n, heightPaperMm: patch.heightPaperMm };
                }
                return n;
            });
            return commitEntities(s, entities);
        }
        case 'editSelectedText': {
            const sel = selectedEntities(s);
            if (sel.length !== 1) return s;
            const e = sel[0];
            if (e.kind === 'text') return { ...s, prompt: { kind: 'edit', anchor: e.at, entityId: e.id, initial: e.text } };
            if (e.kind === 'leader') return { ...s, prompt: { kind: 'edit', anchor: e.points[e.points.length - 1], entityId: e.id, initial: e.text } };
            if (e.kind === 'dimension') return { ...s, prompt: { kind: 'edit', anchor: e.b, entityId: e.id, initial: e.textOverride ?? '' } };
            return s;
        }
        case 'promptSubmit': {
            const pr = s.prompt;
            if (!pr) return s;
            const text = a.text;
            if (pr.kind === 'edit') {
                const entities = s.drawing.entities.map((e): DrawingEntity => {
                    if (e.id !== pr.entityId) return e;
                    if (e.kind === 'text' || e.kind === 'leader') return { ...e, text };
                    if (e.kind === 'dimension') return { ...e, textOverride: text.trim() === '' ? null : text };
                    return e;
                });
                return commitEntities(s, entities, { prompt: null });
            }
            if (text.trim() === '') return resetStage(s);
            if (pr.kind === 'text') {
                return addEntities(
                    s,
                    [
                        {
                            ...base(s),
                            kind: 'text',
                            at: pr.anchor,
                            text,
                            heightPaperMm: s.settings.textHeight,
                            rotationDeg: parseNum(s.settings.angle) ?? 0,
                            align: 'left',
                        },
                    ],
                    { prompt: null, pts: [] },
                );
            }
            return addEntities(
                s,
                [{ ...base(s), kind: 'leader', points: pr.points, text, heightPaperMm: s.settings.textHeight }],
                { prompt: null, pts: [] },
            );
        }
        case 'promptCancel':
            return resetStage(s);
        case 'setLayer': {
            const layers = s.drawing.layers.map((l) => (l.id === a.id ? { ...l, ...a.patch } : l));
            // 見えなくした／ロックしたレイヤの図形は選択から外す
            const ok = new Set(layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
            const layerOf = new Map(s.drawing.entities.map((e) => [e.id, e.layer]));
            return {
                ...s,
                drawing: { ...s.drawing, layers },
                selection: s.selection.filter((id) => ok.has(layerOf.get(id) ?? 0)),
            };
        }
        case 'setCurrentLayer': {
            // 書込レイヤは見えてロックされていない状態にする（描いたものが見えないと困るので）
            const layers = s.drawing.layers.map((l) => (l.id === a.id ? { ...l, visible: true, locked: false } : l));
            return { ...s, drawing: { ...s.drawing, layers, currentLayer: a.id } };
        }
        case 'setSettings':
            return { ...s, settings: { ...s.settings, ...a.patch } };
        case 'setPaper': {
            const paper = { size: a.size ?? s.drawing.paper.size, orientation: a.orientation ?? s.drawing.paper.orientation };
            const origin = keepCenter(s.drawing, { scale: s.drawing.scale, paper });
            return { ...s, drawing: { ...s.drawing, paper, origin }, view: { ...s.view, initialized: false } };
        }
        case 'setScale': {
            const origin = keepCenter(s.drawing, { scale: a.scale, paper: s.drawing.paper });
            return { ...s, drawing: { ...s.drawing, scale: a.scale, origin } };
        }
        case 'setOrigin':
            return { ...s, drawing: { ...s.drawing, origin: a.origin } };
        case 'setDrawingFlags':
            return { ...s, drawing: { ...s.drawing, ...a.patch } };
        case 'setTitleBlock':
            return { ...s, drawing: { ...s.drawing, titleBlock: { ...s.drawing.titleBlock, ...a.patch } } };
        case 'setView':
            return { ...s, view: { ...s.view, ...a.patch } };
        case 'hover':
            return { ...s, cursor: a.p, cursorShift: !!a.shift };
        case 'setMessage':
            return { ...s, message: a.message };
        case 'undo': {
            if (s.past.length === 0) return s;
            const prev = s.past[s.past.length - 1];
            const ids = new Set(prev.map((e) => e.id));
            return {
                ...resetStage(s),
                drawing: { ...s.drawing, entities: prev },
                past: s.past.slice(0, -1),
                future: [s.drawing.entities, ...s.future].slice(0, HISTORY_LIMIT),
                selection: s.selection.filter((id) => ids.has(id)),
            };
        }
        case 'redo': {
            if (s.future.length === 0) return s;
            const next = s.future[0];
            const ids = new Set(next.map((e) => e.id));
            return {
                ...resetStage(s),
                drawing: { ...s.drawing, entities: next },
                past: [...s.past, s.drawing.entities].slice(-HISTORY_LIMIT),
                future: s.future.slice(1),
                selection: s.selection.filter((id) => ids.has(id)),
            };
        }
        case 'replaceDrawing': {
            const ids = new Set(a.drawing.entities.map((e) => e.id));
            return { ...resetStage(s), drawing: a.drawing, selection: s.selection.filter((id) => ids.has(id)) };
        }
    }
}

// ---------------------------------------------------------------------------
// 画面のための計算（プレビュー・案内文・座標の変換）
// ---------------------------------------------------------------------------

/** いま描いている途中の図形（ゴム線）。id は 'preview' で始まる */
export function previewEntities(s: EditorState): DrawingEntity[] {
    const c = s.cursor;
    if (!c || s.prompt) return [];
    const b = { id: 'preview', layer: s.drawing.currentLayer, style: currentStyle(s) };
    const p = usesConstraint(s) ? constrainPoint(s, s.pts[s.pts.length - 1], c, s.cursorShift) : c;
    const pts = s.pts;
    switch (s.command) {
        case 'line':
            return pts.length === 1 ? [{ ...b, kind: 'line', a: pts[0], b: p }] : [];
        case 'polyline':
            return pts.length >= 1 ? [{ ...b, kind: 'polyline', points: [...pts, p], closed: false }] : [];
        case 'measureDistance':
            return pts.length === 1 ? [{ ...b, kind: 'line', a: pts[0], b: p }] : [];
        case 'measureArea':
            return pts.length >= 1 ? [{ ...b, kind: 'polyline', points: [...pts, p], closed: pts.length >= 2 }] : [];
        case 'rect':
            return pts.length === 1
                ? [{ ...b, kind: 'polyline', points: [pts[0], { x: p.x, y: pts[0].y }, p, { x: pts[0].x, y: p.y }], closed: true }]
                : [];
        case 'circle':
            return pts.length === 1 && distance(pts[0], p) > EPS ? [{ ...b, kind: 'circle', center: pts[0], r: distance(pts[0], p) }] : [];
        case 'arc': {
            if (pts.length === 1) return [{ ...b, kind: 'line', a: pts[0], b: p }];
            if (pts.length === 2) {
                const r = distance(pts[0], pts[1]);
                const sd = angleDeg(pts[0], pts[1]);
                let ed = angleDeg(pts[0], p);
                if (ed <= sd) ed += 360;
                return [{ ...b, kind: 'arc', center: pts[0], r, startDeg: sd, endDeg: ed }];
            }
            return [];
        }
        case 'double': {
            const w = parseNum(s.settings.doubleWidth);
            if (pts.length !== 1 || w == null || w <= 0 || distance(pts[0], p) < EPS) return [];
            const { left, right } = doubleLine(pts[0], p, w);
            return [
                { ...b, kind: 'line', a: left[0], b: left[1] },
                { ...b, kind: 'line', a: right[0], b: right[1], id: 'preview2' },
            ];
        }
        case 'leader':
            return pts.length === 1 ? [{ ...b, kind: 'leader', points: [pts[0], p], text: '', heightPaperMm: s.settings.textHeight }] : [];
        case 'dimension': {
            const mode = s.settings.dimMode;
            if (s.chain) {
                const prev = pts[pts.length - 1];
                return [{ ...makeDimension(s, prev, p, s.chain.mode, chainOffset(s.chain, prev, p)), id: 'preview' }];
            }
            if (pts.length === 1) return [{ ...b, kind: 'line', a: pts[0], b: p }];
            if (pts.length === 2) {
                const m: DimensionMode = mode === 'chain' ? chainMode(pts[0], pts[1]) : mode;
                return [{ ...makeDimension(s, pts[0], pts[1], m, offsetFor(m, pts[0], pts[1], p)), id: 'preview' }];
            }
            return [];
        }
        case 'copy':
        case 'move':
        case 'rotate':
        case 'mirror': {
            if (s.phase !== 'points') return [];
            const t = transformed(s, p, true);
            return t ? t.map((e, i) => ({ ...e, id: `preview${i}` })) : [];
        }
        default:
            return [];
    }
}

/** ステータスバーの案内文 */
export function guidance(s: EditorState): string {
    const LR = ' (L)自由点 (R)読取点';
    const n = s.pts.length;
    if (s.prompt) return '◆文字を入れて Enter（Esc でやめる）';
    switch (s.command) {
        case 'select':
            return '◆図形をクリック、またはドラッグで囲んで選んでください（Shift で追加）';
        case 'attr':
            return s.selection.length === 0 ? '◆属性を変える図形を選んでください' : '◆上の欄で属性を選んで「この属性にする」を押してください';
        case 'erase':
            return '◆消す図形をクリック、またはドラッグで囲んでください';
        case 'copy':
        case 'move':
        case 'rotate':
        case 'mirror': {
            if (s.phase === 'select') return `◆${COMMAND_LABELS[s.command]}する図形を選んで Enter（またはコントロールバーの「選んだら次へ」）`;
            if (s.command === 'rotate') {
                if (n === 0) return `◆回転の中心を指示してください${LR}${parseNum(s.settings.angle) != null ? '' : '（角度の欄に入れると 1 回で回ります）'}`;
                return `◆向きの点を指示してください${LR}`;
            }
            if (s.command === 'mirror') return n === 0 ? `◆反転の軸の 1 点目を指示してください${LR}` : `◆反転の軸の 2 点目を指示してください${LR}`;
            return n === 0 ? `◆基点を指示してください${LR}` : `◆${s.command === 'copy' ? '複写先' : '移動先'}を指示してください${LR}（長さを入れて Enter でも）`;
        }
        case 'line':
        case 'double':
            return n === 0 ? `◆始点を指示してください${LR}` : `◆終点を指示してください${LR}（長さを入れて Enter でも・Shift で水平垂直）`;
        case 'polyline':
            return n === 0 ? `◆始点を指示してください${LR}` : `◆次の点を指示してください${LR}（Enter／Esc で終わり・始点で閉じる）`;
        case 'rect':
            return n === 0 ? `◆1 つ目の角を指示してください${LR}` : `◆向かいの角を指示してください${LR}`;
        case 'circle':
            return n === 0 ? `◆中心を指示してください${LR}` : `◆円の上の点を指示してください${LR}（半径を長さに入れて Enter でも）`;
        case 'arc':
            return n === 0 ? `◆中心を指示してください${LR}` : n === 1 ? `◆始まりの点を指示してください${LR}` : `◆終わりの角度の点を指示してください${LR}（反時計回り）`;
        case 'text':
            return `◆文字を書く位置を指示してください${LR}`;
        case 'leader':
            return n === 0 ? `◆矢印の先を指示してください${LR}` : `◆文字を書く位置を指示してください${LR}`;
        case 'dimension':
            if (s.chain) return `◆次の点を指示してください${LR}（Esc で終わり）`;
            return n === 0 ? `◆測る 1 点目を指示してください${LR}` : n === 1 ? `◆測る 2 点目を指示してください${LR}` : `◆寸法線の位置を指示してください${LR}`;
        case 'hatch':
            return '◆塗る形（閉じた連続線・矩形・円）をクリックしてください';
        case 'measureDistance':
            return n === 0 ? `◆測る 1 点目を指示してください${LR}` : `◆測る 2 点目を指示してください${LR}`;
        case 'measureArea':
            return n === 0 ? `◆面積を測る 1 点目を指示してください${LR}` : `◆次の点を指示してください${LR}（Enter／Esc で面積を出す）`;
    }
}

/** ドラッグで囲んで選べる段階か（それ以外のドラッグはクリック扱い） */
export function isPickingStage(s: EditorState): boolean {
    if (s.command === 'select' || s.command === 'attr' || s.command === 'erase') return true;
    return TRANSFORM_COMMANDS.includes(s.command) && s.phase === 'select';
}

/** 実寸 → 画面 px（Y 下向き） */
export function realToScreen(d: Pick<RoadPermitDrawing, 'origin' | 'scale' | 'paper'>, v: Pick<ViewState, 'pxPerMm' | 'panX' | 'panY'>, p: DrawingPoint): { x: number; y: number } {
    const { h } = drawingPaperMm(d);
    const q = toPaper(p, d);
    return { x: v.panX + q.x * v.pxPerMm, y: v.panY + (h - q.y) * v.pxPerMm };
}

/** 画面 px → 実寸 */
export function screenToReal(d: Pick<RoadPermitDrawing, 'origin' | 'scale' | 'paper'>, v: Pick<ViewState, 'pxPerMm' | 'panX' | 'panY'>, sx: number, sy: number): DrawingPoint {
    const { h } = drawingPaperMm(d);
    return fromPaper({ x: (sx - v.panX) / v.pxPerMm, y: h - (sy - v.panY) / v.pxPerMm }, d);
}

/** 用紙が画面の真ん中に収まる表示 */
export function fitView(d: Pick<RoadPermitDrawing, 'paper'>, width: number, height: number): Pick<ViewState, 'pxPerMm' | 'panX' | 'panY'> {
    const { w, h } = drawingPaperMm(d);
    const pad = 24;
    const pxPerMm = Math.max(0.2, Math.min((width - pad * 2) / w, (height - pad * 2) / h));
    return { pxPerMm, panX: (width - w * pxPerMm) / 2, panY: (height - h * pxPerMm) / 2 };
}

export const MIN_PX_PER_MM = 0.2;
export const MAX_PX_PER_MM = 200;

/** 画面の (sx, sy) を中心に拡大縮小 */
export function zoomAt(v: ViewState, sx: number, sy: number, factor: number): Pick<ViewState, 'pxPerMm' | 'panX' | 'panY'> {
    const next = Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, v.pxPerMm * factor));
    const k = next / v.pxPerMm;
    return { pxPerMm: next, panX: sx - (sx - v.panX) * k, panY: sy - (sy - v.panY) * k };
}

/** 表示倍率（%）。画面の 96dpi で用紙を原寸に見せるときを 100% とする */
export function zoomPercent(v: Pick<ViewState, 'pxPerMm'>): number {
    return Math.round((v.pxPerMm / (96 / 25.4)) * 100);
}

/** 表題欄の既定（空の欄は申請の入力値から） */
export function titleBlockDefaults(values: RoadPermitValues | null | undefined): DrawingTitleBlock {
    if (!values) return { drawingName: '保安施設配置図（平面図）', location: '', routeName: '', period: '', author: '' };
    const from = values.period.workFrom || values.period.useFrom;
    const to = values.period.workTo || values.period.useTo;
    return {
        drawingName: '保安施設配置図（平面図）',
        location: values.site.location,
        routeName: values.road.routeName,
        period: from || to ? formatReiwaRange(from, to) : '',
        author: values.applicant.companyName,
    };
}

/** 表題欄に実際に出す値（入力があればそれ・空なら既定） */
export function effectiveTitleBlock(tb: DrawingTitleBlock, values: RoadPermitValues | null | undefined): DrawingTitleBlock {
    const def = titleBlockDefaults(values);
    return {
        drawingName: tb.drawingName || def.drawingName,
        location: tb.location || def.location,
        routeName: tb.routeName || def.routeName,
        period: tb.period || def.period,
        author: tb.author || def.author,
    };
}

export type { BBox };
