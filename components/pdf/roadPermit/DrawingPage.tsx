/**
 * 道路申請 PDF の図面のページ（平面図＝保安施設配置図）。申請書の最後に 1 ページ入れる。
 *
 * 作りの決まり（docs/指示書_道路申請_Phase2.md §3・設計書 §6.9）
 * - ページは用紙の大きさ（A3 横 1190.55×841.89pt など）。中身は react-pdf の Svg で**線として**描く（画像にしない＝印刷がきれい）。
 * - 座標は lib/roadPermit/drawing/paper.ts の toPt（実寸 mm・Y 上向き → pt・Y 下向き）。Svg の viewBox はページと同じ pt。
 * - 印刷は黒だけ（画面のレイヤ色は使わない）。印刷するのは visible かつ printable のレイヤだけ。
 * - 図形は用紙の枠（10mm 内側）で切り取る。表題欄・縮尺・方位は図形の上に重ねる。
 * - 部品（線・矢印・文字）は drawingPdfShared.tsx。
 * - 記号（Phase 2b）は記号の表（symbols）の形を placedSymbolPolylines で置いて、細い線で描く。表に無ければ ○ と「記号が見つかりません」。
 * - 占用範囲（Phase 2b）は 斜線（間隔 3mm）＋輪郭（普通）＋中に「占用 8.991㎡」。
 * - 凡例（Phase 2b・showLegend）は表題欄の上に、置いた記号の下絵・名前・数（印刷するレイヤの記号だけ数える）。
 */
import React from 'react';
import { ClipPath, Defs, G, Page, Rect, Svg, Text as PdfText } from '@react-pdf/renderer';
import type { RoadPermitValues } from '@/types/roadPermit';
import type { DrawingEntity, DrawingLayer, RoadPermitDrawing } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
import type { RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';
import { isSymbolGeometryEmpty, placedSymbolPolylines, symbolBBox, symbolPolylines } from '@/lib/roadPermit/symbols/geometry';
import { legendLayout, legendRows, legendVisibleRows, LEGEND_WIDTH_MM } from '@/lib/roadPermit/symbols/counting';
import { occupancyLabel, occupancyLabelPoint } from '@/lib/roadPermit/drawing/occupancy';
import { OCCUPANCY_HATCH_SPACING_PAPER_MM } from '@/lib/roadPermit/drawing/defaults';
import { drawingPaperMm, PAPER_MARGIN_MM, PT_PER_MM, scaleLabel, toPt } from '@/lib/roadPermit/drawing/paper';
import { arcPoints, circlePoints, dimensionLabel, dimensionLinePoints, hatchLines } from '@/lib/roadPermit/drawing/geometry';
import { formatReiwaRange } from '@/lib/roadPermit/format';
import {
    ArrowHead,
    DrawText,
    estimateDrawTextWidth,
    INK,
    lineWidthPt,
    PolyPt,
    readableAngle,
    SegPt,
    strokeDash,
    type Pt,
} from './drawingPdfShared';

export interface DrawingPageProps {
    drawing: RoadPermitDrawing;
    values: RoadPermitValues;
    /** symbolId → 記号（形）。無ければ記号は ○ と「記号が見つかりません」 */
    symbols?: RoadPermitSymbolMap;
}

const NO_SYMBOLS: RoadPermitSymbolMap = new Map();

const mm = (v: number) => v * PT_PER_MM;

/** 寸法の矢印の長さ（用紙上 mm）・引出し線のすき間とはみ出し（用紙上 mm） */
const DIM_ARROW_MM = 2.5;
const DIM_EXT_GAP_MM = 1;
const DIM_EXT_OVER_MM = 1;
/** 寸法値と寸法線のすき間（用紙上 mm） */
const DIM_TEXT_GAP_MM = 0.8;
/** 引出線の矢印・文字とのすき間（用紙上 mm） */
const LEADER_ARROW_MM = 2.5;
const LEADER_TEXT_GAP_MM = 1;

// ---------------------------------------------------------------------------
// 図形 1 つ
// ---------------------------------------------------------------------------

/**
 * 描く部分。図形の線は用紙の枠で切り取る（clip）が、react-pdf 4.x では clip の中の Svg の Text が描かれないため、
 * 文字だけは切り取りの外で別に描く（'shape' = 線・塗り／'text' = 文字）。基準点が枠の外の文字は出さない。
 */
type Part = 'shape' | 'text';

interface FrameBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** 文字の基準点が用紙の枠の中か */
function inFrame(p: Pt, f: FrameBox): boolean {
    return p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h;
}

function EntityShape({ e, d, part, frame, symbols }: { e: DrawingEntity; d: RoadPermitDrawing; part: Part; frame: FrameBox; symbols: RoadPermitSymbolMap }) {
    const P = (p: { x: number; y: number }): Pt => toPt(p, d);
    const sw = lineWidthPt(e.style.width);
    const dash = strokeDash(e.style.lineType);
    const isShape = part === 'shape';

    switch (e.kind) {
        case 'line':
            if (!isShape) return null;
            return <SegPt a={P(e.a)} b={P(e.b)} sw={sw} dash={dash} />;
        case 'polyline':
            if (!isShape || e.points.length < 2) return null;
            return <PolyPt pts={e.points.map(P)} closed={e.closed} sw={sw} dash={dash} />;
        case 'circle':
            if (!isShape) return null;
            return <PolyPt pts={circlePoints(e, 72).map(P)} closed sw={sw} dash={dash} />;
        case 'arc':
            if (!isShape) return null;
            return <PolyPt pts={arcPoints(e).map(P)} closed={false} sw={sw} dash={dash} />;
        case 'text':
            if (isShape || !inFrame(P(e.at), frame)) return null;
            return (
                <DrawText
                    at={P(e.at)}
                    text={e.text}
                    sizePt={mm(e.heightPaperMm)}
                    // 図形の角度は反時計回り（Y 上向き）。pt は Y 下向きなので符号が逆になる
                    rotateDeg={-e.rotationDeg}
                    anchor={e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}
                />
            );
        case 'dimension':
            return <Dimension e={e} d={d} sw={sw} part={part} frame={frame} />;
        case 'leader':
            return <Leader e={e} d={d} sw={sw} dash={dash} part={part} frame={frame} />;
        case 'hatch':
            return isShape ? <Hatch e={e} d={d} sw={sw} /> : null;
        case 'occupancy': {
            if (e.points.length < 3) return null;
            if (isShape) {
                const segs = hatchLines(e.points, OCCUPANCY_HATCH_SPACING_PAPER_MM * d.scale, 45);
                const thin = lineWidthPt('thin');
                return (
                    <>
                        {segs.map(([a, b], i) => (
                            <SegPt key={i} a={P(a)} b={P(b)} sw={thin} />
                        ))}
                        <PolyPt pts={e.points.map(P)} closed sw={lineWidthPt('normal')} dash={dash} />
                    </>
                );
            }
            // 文字の中ほどが多角形の重心に来るように（基準点は文字の下端）
            const c = P(occupancyLabelPoint(e.points));
            if (!inFrame(c, frame)) return null;
            const size = mm(OCCUPANCY_TEXT_MM);
            const label = occupancyLabel(e);
            // ハッチの上でも読めるよう、文字の範囲を白で塗ってから書く（文字は切り取りの外＝線の上に描かれる）
            const labelW = estimateDrawTextWidth(label, size);
            const padX = mm(1);
            return (
                <>
                    <Rect x={c.x - labelW / 2 - padX} y={c.y - size * 0.7} width={labelW + padX * 2} height={size * 1.4} fill="#ffffff" />
                    <DrawText at={{ x: c.x, y: c.y + size * 0.35 }} text={label} sizePt={size} anchor="middle" />
                </>
            );
        }
        case 'symbol': {
            const sym = symbols.get(e.symbolId);
            if (sym && !isSymbolGeometryEmpty(sym.geometry)) {
                // 記号の形を置いた位置・角度・反転で線にする（線の太さは「細」）。文字は持たない
                if (!isShape) return null;
                const thin = lineWidthPt('thin');
                return (
                    <>
                        {placedSymbolPolylines(sym.geometry, e).map((poly, i) => (
                            <PolyPt key={i} pts={poly.map(P)} closed={false} sw={thin} />
                        ))}
                    </>
                );
            }
            // 記号の表に無い（消された・読み込めない）: 基準点に小さな ○ と「記号が見つかりません」
            const at = P(e.at);
            const r = mm(1.5);
            const circle = circlePoints({ center: { x: 0, y: 0 }, r }, 24).map((p) => ({ x: at.x + p.x, y: at.y + p.y }));
            if (isShape) return <PolyPt pts={circle} closed sw={sw} />;
            if (!inFrame(at, frame)) return null;
            return <DrawText at={{ x: at.x + r + mm(0.8), y: at.y + mm(0.8) }} text="記号が見つかりません" sizePt={mm(2)} />;
        }
        default:
            return null;
    }
}

/** 占用範囲の中の文字の大きさ（用紙上 mm） */
const OCCUPANCY_TEXT_MM = 3;

/** 寸法: 寸法線・引出し線 2 本・両端の矢印・寸法値 */
function Dimension({
    e,
    d,
    sw,
    part,
    frame,
}: {
    e: Extract<DrawingEntity, { kind: 'dimension' }>;
    d: RoadPermitDrawing;
    sw: number;
    part: Part;
    frame: FrameBox;
}) {
    const P = (p: { x: number; y: number }): Pt => toPt(p, d);
    const { p1, p2 } = dimensionLinePoints(e);
    const A = P(e.a);
    const B = P(e.b);
    const P1 = P(p1);
    const P2 = P(p2);

    /** 測る点 → 寸法線の端 の引出し線（測る点から 1mm 離し、寸法線を 1mm 越える） */
    const extension = (from: Pt, to: Pt): [Pt, Pt] | null => {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (len < mm(DIM_EXT_GAP_MM) + 0.01) return null;
        const u = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
        return [
            { x: from.x + u.x * mm(DIM_EXT_GAP_MM), y: from.y + u.y * mm(DIM_EXT_GAP_MM) },
            { x: to.x + u.x * mm(DIM_EXT_OVER_MM), y: to.y + u.y * mm(DIM_EXT_OVER_MM) },
        ];
    };
    const ext1 = extension(A, P1);
    const ext2 = extension(B, P2);

    // 寸法値: 寸法線の中央の少し上・寸法線に沿って回転（逆さにならない向きにそろえる）
    const ang = readableAngle(Math.atan2(P2.y - P1.y, P2.x - P1.x) * (180 / Math.PI));
    const rad = (ang * Math.PI) / 180;
    // 文字の「上」方向（pt・Y 下向き）= 文字の進む向きを反時計回りに 90 度
    const upX = Math.sin(rad);
    const upY = -Math.cos(rad);
    const mid = { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2 };
    const textAt = { x: mid.x + upX * mm(DIM_TEXT_GAP_MM), y: mid.y + upY * mm(DIM_TEXT_GAP_MM) };

    if (part === 'text') {
        if (!inFrame(textAt, frame)) return null;
        return <DrawText at={textAt} text={dimensionLabel(e)} sizePt={mm(e.heightPaperMm)} rotateDeg={ang} anchor="middle" />;
    }
    return (
        <>
            <SegPt a={P1} b={P2} sw={sw} />
            {ext1 && <SegPt a={ext1[0]} b={ext1[1]} sw={sw} />}
            {ext2 && <SegPt a={ext2[0]} b={ext2[1]} sw={sw} />}
            <ArrowHead tip={P1} from={P2} lengthPt={mm(DIM_ARROW_MM)} />
            <ArrowHead tip={P2} from={P1} lengthPt={mm(DIM_ARROW_MM)} />
        </>
    );
}

/** 引出線: 折れ線＋先端（最初の点）の矢印＋最後の点の先に文字 */
function Leader({
    e,
    d,
    sw,
    dash,
    part,
    frame,
}: {
    e: Extract<DrawingEntity, { kind: 'leader' }>;
    d: RoadPermitDrawing;
    sw: number;
    dash: string | undefined;
    part: Part;
    frame: FrameBox;
}) {
    if (e.points.length < 2) return null;
    const pts = e.points.map((p) => toPt(p, d));
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const toRight = last.x >= prev.x;
    const size = mm(e.heightPaperMm);
    // 文字は最後の線の先に、線の高さに文字の中ほどが来るように置く
    const textAt = { x: last.x + (toRight ? 1 : -1) * mm(LEADER_TEXT_GAP_MM), y: last.y + size * 0.35 };
    if (part === 'text') {
        if (!inFrame(last, frame)) return null;
        return <DrawText at={textAt} text={e.text} sizePt={size} anchor={toRight ? 'start' : 'end'} />;
    }
    return (
        <>
            <PolyPt pts={pts} closed={false} sw={sw} dash={dash} />
            <ArrowHead tip={pts[0]} from={pts[1]} lengthPt={mm(LEADER_ARROW_MM)} />
        </>
    );
}

/** ハッチ: 斜線（間隔は用紙上 mm → 実寸に直す）。cross は 45° と 135°、solid は薄い灰色で塗る */
function Hatch({ e, d, sw }: { e: Extract<DrawingEntity, { kind: 'hatch' }>; d: RoadPermitDrawing; sw: number }) {
    if (e.points.length < 3) return null;
    if (e.pattern === 'solid') {
        return <PolyPt pts={e.points.map((p) => toPt(p, d))} closed sw={0} fill="#d9d9d9" />;
    }
    const spacing = e.spacingPaperMm * d.scale;
    const segs = [...hatchLines(e.points, spacing, 45), ...(e.pattern === 'cross' ? hatchLines(e.points, spacing, 135) : [])];
    return (
        <>
            {segs.map(([a, b], i) => (
                <SegPt key={i} a={toPt(a, d)} b={toPt(b, d)} sw={sw} />
            ))}
        </>
    );
}

// ---------------------------------------------------------------------------
// 表題欄・縮尺の棒・方位
// ---------------------------------------------------------------------------

/** 表題欄の 1 行（見出し・中身）。欄が空なら values から自動で入れる */
export function titleBlockRows(drawing: RoadPermitDrawing, values: RoadPermitValues): { label: string; value: string }[] {
    const tb = drawing.titleBlock;
    const pick = (own: string, auto: string) => (own.trim() !== '' ? own : auto);
    return [
        { label: '図面名', value: pick(tb.drawingName, '保安施設配置図（平面図）') },
        { label: '場　所', value: pick(tb.location, values.site.location) },
        { label: '路線名', value: pick(tb.routeName, values.road.routeName) },
        { label: '期　間', value: pick(tb.period, formatReiwaRange(values.period.useFrom, values.period.useTo)) },
        { label: '縮　尺', value: `${scaleLabel(drawing.scale)}（${drawing.paper.size}）` },
        { label: '作　成', value: pick(tb.author, values.applicant.companyName) },
    ];
}

/** 表題欄の大きさ（用紙上 mm） */
const TB_W_MM = 140;
const TB_ROW_MM = 8;
const TB_LABEL_W_MM = 22;
const TB_FONT_MM = 2.8;

/** 右下の表題欄。枠の右下の角に付ける（下に図形があっても白で塗ってから書く） */
function TitleBlock({ right, bottom, rows }: { right: number; bottom: number; rows: { label: string; value: string }[] }) {
    const w = mm(TB_W_MM);
    const rh = mm(TB_ROW_MM);
    const h = rh * rows.length;
    const x0 = right - w;
    const y0 = bottom - h;
    const lx = x0 + mm(TB_LABEL_W_MM);
    const fs = mm(TB_FONT_MM);
    const pad = mm(2.5);
    const valueW = right - lx - pad * 2;
    const sw = lineWidthPt('normal');
    return (
        <>
            <Rect x={x0} y={y0} width={w} height={h} fill="#ffffff" stroke={INK} strokeWidth={lineWidthPt('thick')} />
            <SegPt a={{ x: lx, y: y0 }} b={{ x: lx, y: bottom }} sw={sw} />
            {rows.map((r, i) => {
                const top = y0 + rh * i;
                // 文字の中ほどを行の中ほどに（ベースライン = 中ほど + 0.35em）
                const baseY = top + rh / 2 + fs * 0.35;
                // 長い値（期間など）は欄に収まるまで小さくする
                const est = estimateDrawTextWidth(r.value, fs);
                const vfs = est > valueW ? Math.max(fs * 0.6, (fs * valueW) / est) : fs;
                return (
                    <React.Fragment key={r.label}>
                        {i > 0 && <SegPt a={{ x: x0, y: top }} b={{ x: right, y: top }} sw={sw} />}
                        <DrawText at={{ x: x0 + mm(TB_LABEL_W_MM) / 2, y: baseY }} text={r.label} sizePt={fs} anchor="middle" />
                        <DrawText at={{ x: lx + pad, y: top + rh / 2 + vfs * 0.35 }} text={r.value} sizePt={vfs} />
                    </React.Fragment>
                );
            })}
        </>
    );
}

/** 凡例の下絵: 記号の形を size（pt）の正方形に収めて、中心 (cx, cy) に描く */
function LegendThumb({ geometry, cx, cy, size }: { geometry: RoadPermitSymbolGeometry; cx: number; cy: number; size: number }) {
    const bb = symbolBBox(geometry);
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    if (!(span > 0)) return null;
    const k = size / span;
    const mx = (bb.minX + bb.maxX) / 2;
    const my = (bb.minY + bb.maxY) / 2;
    const thin = lineWidthPt('thin');
    return (
        <>
            {symbolPolylines(geometry).map((poly, i) =>
                poly.length < 2 ? null : (
                    <PolyPt key={i} pts={poly.map((p) => ({ x: cx + (p.x - mx) * k, y: cy - (p.y - my) * k }))} closed={false} sw={thin} />
                ),
            )}
        </>
    );
}

/**
 * 凡例（表題欄の上・右寄せ・幅 140mm）。1 行＝下絵（8mm 角）・名前・数。下に図形があっても白で塗ってから描く。
 * 12 行を超えたら最後の行を「ほか n 種」にする。行が多いほど小さくする（legendLayout）
 */
function Legend({ right, bottom, drawing, symbols }: { right: number; bottom: number; drawing: RoadPermitDrawing; symbols: RoadPermitSymbolMap }) {
    const all = legendRows(drawing.entities, symbols, drawing.layers);
    if (all.length === 0) return null;
    const { rows, more } = legendVisibleRows(all);
    const lines = [
        ...rows.map((r) => ({ key: r.symbolId, geometry: r.geometry as RoadPermitSymbolGeometry | null, name: r.name, count: `${r.count} ${r.unit}` })),
        ...(more > 0 ? [{ key: '__more', geometry: null, name: `ほか ${more} 種`, count: '' }] : []),
    ];
    const lay = legendLayout(lines.length);
    const w = mm(LEGEND_WIDTH_MM);
    const h = mm(lay.heightMm);
    const x0 = right - w;
    const y0 = bottom - h;
    const fs = mm(lay.fontMm);
    const header = mm(lay.headerMm);
    const rh = mm(lay.rowMm);
    const thumb = mm(lay.thumbMm);
    const sw = lineWidthPt('normal');
    const nameX = x0 + mm(2) + thumb + mm(3);
    const countX = right - mm(3);
    const nameW = countX - mm(18) - nameX;
    return (
        <>
            <Rect x={x0} y={y0} width={w} height={h} fill="#ffffff" stroke={INK} strokeWidth={lineWidthPt('thick')} />
            <DrawText at={{ x: x0 + w / 2, y: y0 + header / 2 + fs * 0.35 }} text="凡　例" sizePt={fs} anchor="middle" />
            {lines.map((r, i) => {
                const top = y0 + header + rh * i;
                const midY = top + rh / 2;
                const est = estimateDrawTextWidth(r.name, fs);
                const nfs = est > nameW ? Math.max(fs * 0.6, (fs * nameW) / est) : fs;
                return (
                    <React.Fragment key={r.key}>
                        <SegPt a={{ x: x0, y: top }} b={{ x: right, y: top }} sw={sw} />
                        {r.geometry && <LegendThumb geometry={r.geometry} cx={x0 + mm(2) + thumb / 2} cy={midY} size={thumb} />}
                        <DrawText at={{ x: nameX, y: midY + nfs * 0.35 }} text={r.name} sizePt={nfs} />
                        {r.count && <DrawText at={{ x: countX, y: midY + fs * 0.35 }} text={r.count} sizePt={fs} anchor="end" />}
                    </React.Fragment>
                );
            })}
        </>
    );
}

/** 縮尺の棒の 1 区切り（m）。5 区切りの長さが用紙上 50mm にいちばん近いものを選ぶ */
export function scaleBarStepM(scale: number): number {
    const steps = [0.5, 1, 2, 5];
    let best = steps[0];
    let bestDiff = Infinity;
    for (const s of steps) {
        const lenMm = (5 * s * 1000) / scale;
        const diff = Math.abs(lenMm - 50);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = s;
        }
    }
    return best;
}

/** 左下の縮尺の棒（白黒 5 区切り）。left・bottom は棒の左下（pt） */
function ScaleBar({ left, bottom, scale }: { left: number; bottom: number; scale: number }) {
    const step = scaleBarStepM(scale);
    const segW = mm((step * 1000) / scale);
    const barH = mm(1.5);
    const fs = mm(2.5);
    const top = bottom - barH;
    const total = step * 5;
    const fmt = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
    return (
        <>
            {/* 下に図形があっても読めるよう、棒と文字の範囲を白で塗ってから描く */}
            <Rect x={left - mm(3)} y={top - mm(1.2) - fs * 1.2} width={segW * 5 + mm(6)} height={barH + fs * 2.4 + mm(2.4)} fill="#ffffff" />
            {Array.from({ length: 5 }, (_, i) => (
                <Rect
                    key={i}
                    x={left + segW * i}
                    y={top}
                    width={segW}
                    height={barH}
                    fill={i % 2 === 0 ? INK : '#ffffff'}
                    stroke={INK}
                    strokeWidth={lineWidthPt('thin')}
                />
            ))}
            <DrawText at={{ x: left + (segW * 5) / 2, y: top - mm(1.2) }} text={scaleLabel(scale)} sizePt={fs} anchor="middle" />
            <DrawText at={{ x: left, y: bottom + mm(1) + fs }} text="0" sizePt={fs} anchor="middle" />
            <DrawText at={{ x: left + segW * 5, y: bottom + mm(1) + fs }} text={`${fmt(total)}m`} sizePt={fs} anchor="middle" />
        </>
    );
}

/** 左上の方位（円・矢印・N）。cx・cy は円の中心（pt） */
function NorthArrow({ cx, cy }: { cx: number; cy: number }) {
    const r = mm(6);
    const sw = lineWidthPt('normal');
    const tip = { x: cx, y: cy - r * 0.85 };
    const tail = { x: cx, y: cy + r * 0.55 };
    const left = { x: cx - r * 0.42, y: cy + r * 0.75 };
    const right = { x: cx + r * 0.42, y: cy + r * 0.75 };
    const circle = circlePoints({ center: { x: 0, y: 0 }, r }, 48).map((p) => ({ x: cx + p.x, y: cy + p.y }));
    return (
        <>
            <PolyPt pts={circle} closed sw={sw} />
            {/* 矢印の左半分は黒く塗り、右半分は白（よくある方位記号の形） */}
            <PolyPt pts={[tip, left, tail]} closed sw={sw} fill={INK} />
            <PolyPt pts={[tip, tail, right]} closed sw={sw} fill="#ffffff" />
            <DrawText at={{ x: cx, y: cy - r - mm(1.5) }} text="N" sizePt={mm(3.5)} anchor="middle" />
        </>
    );
}

// ---------------------------------------------------------------------------
// ページ
// ---------------------------------------------------------------------------

function isPrintable(layers: DrawingLayer[], id: number): boolean {
    const layer = layers.find((l) => l.id === id);
    // レイヤが見つからない（古いデータ）ときは印刷する
    return !layer || (layer.visible && layer.printable);
}

export function DrawingPage({ drawing, values, symbols = NO_SYMBOLS }: DrawingPageProps) {
    const paper = drawingPaperMm(drawing);
    const W = mm(paper.w);
    const H = mm(paper.h);
    const m = mm(PAPER_MARGIN_MM);
    const frame: FrameBox = { x: m, y: m, w: W - m * 2, h: H - m * 2 };
    // Svg の高さをページと同じにすると「ページに収まらない」と警告が出る（小数の誤差）ので、わずかに小さくする。
    // 枠や表題欄は下端から 10mm 内側なので、下の 1pt が無くても何も欠けない
    const SVG_H = H - 1;
    const entities = drawing.entities.filter((e) => isPrintable(drawing.layers, e.layer));
    // ハッチ・塗り・占用範囲は線の下に敷く（線や文字を隠さないように先に描く）
    const under = (e: DrawingEntity) => e.kind === 'hatch' || e.kind === 'occupancy';
    const ordered = [...entities.filter(under), ...entities.filter((e) => !under(e))];

    return (
        <Page size={[W, H]} style={{ position: 'relative', padding: 0, fontFamily: 'NotoSerifJP' }}>
            {/*
              Svg の Text は、同じ PDF の中で普通の Text が一度その書体を使わないと字が化ける（react-pdf 4.x の書体の読み込みが
              普通の Text の分しか走らないため）。申請書のページが無く図面だけのときにも備えて、見えない文字を 1 つ置く。
            */}
            <PdfText style={{ position: 'absolute', left: 0, top: 0, fontSize: 1, color: '#ffffff', fontFamily: 'NotoSerifJP' }}>図</PdfText>
            <Svg style={{ position: 'absolute', left: 0, top: 0, width: W, height: SVG_H }} viewBox={`0 0 ${W} ${SVG_H}`}>
                <Defs>
                    <ClipPath id="drawing-frame">
                        <Rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} />
                    </ClipPath>
                </Defs>
                {/* 図形の線・塗り（用紙の枠で切り取る） */}
                <G clipPath="url(#drawing-frame)">
                    {ordered.map((e) => (
                        <EntityShape key={e.id} e={e} d={drawing} part="shape" frame={frame} symbols={symbols} />
                    ))}
                </G>
                {/* 図形の文字（切り取りの外で描く。基準点が枠の外の文字は出さない） */}
                {ordered.map((e) => (
                    <EntityShape key={`t-${e.id}`} e={e} d={drawing} part="text" frame={frame} symbols={symbols} />
                ))}
                {/* 用紙の枠（10mm 内側） */}
                <Rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="none" stroke={INK} strokeWidth={lineWidthPt('normal')} />
                {drawing.showTitleBlock && (
                    <TitleBlock right={frame.x + frame.w} bottom={frame.y + frame.h} rows={titleBlockRows(drawing, values)} />
                )}
                {drawing.showLegend && (
                    <Legend
                        right={frame.x + frame.w}
                        bottom={frame.y + frame.h - (drawing.showTitleBlock ? mm(TB_ROW_MM) * titleBlockRows(drawing, values).length : 0)}
                        drawing={drawing}
                        symbols={symbols}
                    />
                )}
                {drawing.showScaleBar && <ScaleBar left={frame.x + mm(15)} bottom={frame.y + frame.h - mm(12)} scale={drawing.scale} />}
                {drawing.showNorthArrow && <NorthArrow cx={frame.x + mm(18)} cy={frame.y + mm(20)} />}
            </Svg>
        </Page>
    );
}

