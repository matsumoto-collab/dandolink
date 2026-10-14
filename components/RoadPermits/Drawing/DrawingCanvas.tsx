// 作図画面の用紙（react-konva の Stage）。
// konva は読み込んだ時点で window を使うので、このファイルは必ず next/dynamic の { ssr: false } 経由で使うこと。
'use client';

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { DrawingEntity, DrawingPoint, LineType, RoadPermitDrawing } from '@/types/roadPermitDrawing';
import type { RoadPermitValues } from '@/types/roadPermit';
import type { RoadPermitSymbolDto, RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
import { isSymbolGeometryEmpty, placedSymbolPolylines, symbolBBox, symbolPolylines } from '@/lib/roadPermit/symbols/geometry';
import { legendLayout, legendRows, legendVisibleRows, LEGEND_WIDTH_MM } from '@/lib/roadPermit/symbols/counting';
import {
    OCCUPANCY_LINE_HEIGHT,
    OCCUPANCY_TEXT_PAPER_MM,
    occupancyEntityLabel,
    occupancyLabelAt,
    occupancyNoteAt,
    occupancyNoteLines,
} from '@/lib/roadPermit/drawing/occupancy';
import { LINE_WIDTH_MM, PAPER_MARGIN_MM, drawingPaperMm, scaleLabel } from '@/lib/roadPermit/drawing/paper';
import {
    angleDeg,
    arcPoints,
    circlePoints,
    dimensionLabel,
    dimensionLinePoints,
    hatchLines,
    snapCandidate,
    unit,
    type SnapCandidate,
} from '@/lib/roadPermit/drawing/geometry';
import { DRAWING_LAYER_COLORS } from '@/lib/roadPermit/drawing/defaults';
import {
    effectiveTitleBlock,
    fitView,
    isPickingStage,
    previewEntities,
    realToScreen,
    screenToReal,
    visibleEntities,
    zoomAt,
    type EditorAction,
    type EditorState,
    type ViewState,
} from './editorModel';

interface DrawingCanvasProps {
    state: EditorState;
    dispatch: React.Dispatch<EditorAction>;
    /** 表題欄の既定を出すため */
    values: RoadPermitValues | null;
    /** Space を押している間は左ドラッグでパン */
    spaceDown: boolean;
    /** 記号の表を読み込み中か（読み込み中は「記号が見つかりません」を出さない） */
    symbolsLoading?: boolean;
}

/** 読取点（右クリック）の吸い付く範囲（画面 px） */
const SNAP_PX = 8;
/** これより動いたらクリックではなくドラッグとみなす（px） */
const DRAG_PX = 4;

const COLOR_SELECTED = '#0d9488';
const COLOR_PREVIEW = '#e11d48';
const COLOR_GRID = '#e2e8f0';
const COLOR_FRAME = '#475569';

/** 線種の破線の長さ（用紙上の mm） */
const DASH_MM: Record<LineType, number[] | undefined> = {
    solid: undefined,
    dashed: [3, 1.5],
    dashdot: [6, 1.2, 0.8, 1.2],
    dotted: [0.5, 1],
};

type View = Pick<ViewState, 'pxPerMm' | 'panX' | 'panY'>;
type Geo = Pick<RoadPermitDrawing, 'origin' | 'scale' | 'paper'>;

interface Px {
    x: number;
    y: number;
}

const flat = (pts: Px[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/** 画面に出す文字（基準点＝左下・中央下・右下。回転は反時計回りの度） */
function TextNode({
    at,
    text,
    fontSize,
    rotationDeg,
    align,
    color,
}: {
    at: Px;
    text: string;
    fontSize: number;
    rotationDeg: number;
    align: 'left' | 'center' | 'right';
    color: string;
}) {
    if (fontSize < 1 || text === '') return null;
    const w = Math.max(fontSize, text.length * fontSize * 1.05);
    const offsetX = align === 'left' ? 0 : align === 'center' ? w / 2 : w;
    return (
        <Text
            x={at.x}
            y={at.y}
            text={text}
            fontSize={fontSize}
            fontFamily="serif"
            fill={color}
            width={w}
            align={align}
            offsetX={offsetX}
            offsetY={fontSize}
            rotation={-rotationDeg}
            listening={false}
        />
    );
}

/** 矢印の先（tip へ向かう 2 本の短い線） */
function arrowHead(tip: Px, from: Px, size: number): number[][] {
    const dx = from.x - tip.x;
    const dy = from.y - tip.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const s = Math.sin(Math.PI / 9);
    const c = Math.cos(Math.PI / 9);
    const r1 = { x: tip.x + (ux * c - uy * s) * size, y: tip.y + (ux * s + uy * c) * size };
    const r2 = { x: tip.x + (ux * c + uy * s) * size, y: tip.y + (-ux * s + uy * c) * size };
    return [
        [r1.x, r1.y, tip.x, tip.y, r2.x, r2.y],
    ];
}

/**
 * 置いた記号（記号 1 つ＝konva の Shape 1 つ）。点列は lib/roadPermit/symbols/geometry.ts の placedSymbolPolylines（自前で座標変換を書かない）。
 * 全部の折れ線を 1 つの path にして 1 回で線を引く（コーンを 50 個置いても軽い）
 */
function PlacedSymbol({ e, sym, toS, color, strokeWidth }: { e: Extract<DrawingEntity, { kind: 'symbol' }>; sym: RoadPermitSymbolDto; toS: (p: DrawingPoint) => Px; color: string; strokeWidth: number }) {
    const polys = placedSymbolPolylines(sym.geometry, e).map((poly) => poly.map(toS));
    return (
        <Shape
            sceneFunc={(ctx, shape) => {
                ctx.beginPath();
                for (const poly of polys) {
                    if (poly.length < 2) continue;
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
                }
                ctx.strokeShape(shape);
            }}
            stroke={color}
            strokeWidth={strokeWidth}
            lineCap="round"
            lineJoin="round"
            listening={false}
            perfectDrawEnabled={false}
        />
    );
}

/** 図形 1 つを konva の部品にする */
const EntityShape = memo(function EntityShape({
    e,
    geo,
    view,
    selected,
    preview,
    sym,
    symbolsLoading,
}: {
    e: DrawingEntity;
    geo: Geo;
    view: View;
    selected: boolean;
    preview: boolean;
    /** 記号のときだけ: 記号の表で見つかった記号（無ければ undefined） */
    sym?: RoadPermitSymbolDto;
    symbolsLoading?: boolean;
}) {
    const toS = (p: DrawingPoint) => realToScreen(geo, view, p);
    const px = view.pxPerMm;
    const color = preview ? COLOR_PREVIEW : selected ? COLOR_SELECTED : DRAWING_LAYER_COLORS[e.layer];
    const strokeWidth = Math.max(1, LINE_WIDTH_MM[e.style.width] * px) + (selected ? 1.5 : 0);
    const dashMm = DASH_MM[e.style.lineType];
    const dash = dashMm ? dashMm.map((d) => Math.max(1.5, d * px)) : preview ? [6, 4] : undefined;
    const common = { stroke: color, strokeWidth, dash, listening: false, lineCap: 'round' as const, lineJoin: 'round' as const };
    const thin = { stroke: color, strokeWidth: Math.max(1, LINE_WIDTH_MM.thin * px) + (selected ? 1 : 0), listening: false };

    switch (e.kind) {
        case 'line':
            return <Line points={flat([toS(e.a), toS(e.b)])} {...common} />;
        case 'polyline':
            return <Line points={flat(e.points.map(toS))} closed={e.closed} {...common} />;
        case 'circle':
            return <Line points={flat(circlePoints(e, 72).map(toS))} closed {...common} />;
        case 'arc':
            return <Line points={flat(arcPoints(e).map(toS))} {...common} />;
        case 'text':
            return (
                <TextNode
                    at={toS(e.at)}
                    text={e.text}
                    fontSize={e.heightPaperMm * px}
                    rotationDeg={e.rotationDeg}
                    align={e.align}
                    color={color}
                />
            );
        case 'dimension': {
            const { p1, p2 } = dimensionLinePoints(e);
            const s1 = toS(p1);
            const s2 = toS(p2);
            const arrow = 1.8 * px;
            // 文字は寸法線の上・読める向き（画面で右向き〜上向き）
            let deg = angleDeg(p1, p2);
            if (deg > 90) deg -= 180;
            if (deg <= -90) deg += 180;
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            const n = unit(p1, p2);
            const nrm = { x: -n.y, y: n.x };
            const up = (deg === angleDeg(p1, p2) ? 1 : -1) * 0.6 * geo.scale;
            const labelAt = toS({ x: mid.x + nrm.x * up, y: mid.y + nrm.y * up });
            return (
                <Group listening={false}>
                    <Line points={flat([toS(e.a), s1])} {...thin} />
                    <Line points={flat([toS(e.b), s2])} {...thin} />
                    <Line points={flat([s1, s2])} {...thin} />
                    {arrowHead(s1, s2, arrow).map((pts, i) => (
                        <Line key={`a${i}`} points={pts} {...thin} />
                    ))}
                    {arrowHead(s2, s1, arrow).map((pts, i) => (
                        <Line key={`b${i}`} points={pts} {...thin} />
                    ))}
                    <TextNode
                        at={labelAt}
                        text={dimensionLabel(e)}
                        fontSize={e.heightPaperMm * px}
                        rotationDeg={deg}
                        align="center"
                        color={color}
                    />
                </Group>
            );
        }
        case 'leader': {
            const pts = e.points.map(toS);
            const last = pts[pts.length - 1];
            return (
                <Group listening={false}>
                    <Line points={flat(pts)} {...thin} />
                    {pts.length >= 2 &&
                        arrowHead(pts[0], pts[1], 2 * px).map((p, i) => <Line key={i} points={p} {...thin} />)}
                    <TextNode
                        at={{ x: last.x + 0.8 * px, y: last.y }}
                        text={e.text}
                        fontSize={e.heightPaperMm * px}
                        rotationDeg={0}
                        align="left"
                        color={color}
                    />
                </Group>
            );
        }
        case 'hatch': {
            if (e.pattern === 'solid') {
                return <Line points={flat(e.points.map(toS))} closed fill={color} opacity={0.35} strokeEnabled={false} listening={false} />;
            }
            const spacing = e.spacingPaperMm * geo.scale;
            const segs = [...hatchLines(e.points, spacing, 45), ...(e.pattern === 'cross' ? hatchLines(e.points, spacing, -45) : [])];
            return (
                <Group listening={false}>
                    {segs.map(([a, b], i) => (
                        <Line key={i} points={flat([toS(a), toS(b)])} {...thin} />
                    ))}
                </Group>
            );
        }
        case 'occupancy': {
            // 占用範囲: 薄い塗り＋輪郭（印刷は斜線。PDF 側が正）。式の文字・①②の印は OccupancyLabelsLayer（ドラッグで動かせる）
            const pts = flat(e.points.map(toS));
            return (
                <Group listening={false}>
                    <Line points={pts} closed fill={color} opacity={0.15} strokeEnabled={false} listening={false} />
                    <Line points={pts} closed {...common} />
                </Group>
            );
        }
        case 'symbol': {
            if (sym && !isSymbolGeometryEmpty(sym.geometry)) {
                return <PlacedSymbol e={e} sym={sym} toS={toS} color={color} strokeWidth={thin.strokeWidth} />;
            }
            // 記号の表に無い（消された・読み込めない）: 位置がわかる ○ と「記号が見つかりません」
            const c = toS(e.at);
            const r = Math.max(3, 2 * px);
            return (
                <Group listening={false}>
                    <Circle x={c.x} y={c.y} radius={r} stroke={color} strokeWidth={1} listening={false} />
                    {!symbolsLoading && !preview && (
                        <TextNode at={{ x: c.x + r + 2, y: c.y + Math.max(5, 1 * px) }} text="記号が見つかりません" fontSize={Math.max(10, 2 * px)} rotationDeg={0} align="left" color={color} />
                    )}
                </Group>
            );
        }
    }
});

/** 文字の幅の見積もり（px。全角＝1em・半角＝0.6em。PDF の estimateDrawTextWidth と同じ換算） */
function estimateTextPx(text: string, fontSize: number): number {
    let units = 0;
    for (const ch of text) units += /[\x00-\xff｡-ﾟ²³]/.test(ch) ? 0.6 : 1;
    return units * fontSize;
}

/** 占用範囲の文字の名前（konva の name。Stage の mousedown で「文字のドラッグ」と「図面のクリック」を見分ける） */
const OCCUPANCY_LABEL_NAME = 'occupancy-label';

/** イベントの相手が占用範囲の文字（か、その中の部品）か */
function isOccupancyLabelTarget(ev: KonvaEventObject<MouseEvent | TouchEvent>): boolean {
    const t = ev.target as unknown as { findAncestor?: (sel: string, includeSelf?: boolean) => unknown };
    return typeof t.findAncestor === 'function' && !!t.findAncestor(`.${OCCUPANCY_LABEL_NAME}`, true);
}

/**
 * 動かせる文字の 1 かたまり（白地＋文字）。at は基準点の画面座標。lines の 1 行目の基準を at に置き、2 行目からは下へ並べる。
 * align='center' は 1 行目の中央下を at に（式の文字）・'left' は左上を at に（まとまり）。
 * ドラッグして離したら onMoved に新しい基準点（画面 px）を渡す。クリック（動かさず離す）は onClick
 */
function DraggableLabel({
    at,
    lines,
    fontSize,
    align,
    color,
    enabled,
    onMoved,
    onClick,
    onHover,
}: {
    at: Px;
    lines: string[];
    fontSize: number;
    align: 'center' | 'left';
    color: string;
    enabled: boolean;
    onMoved: (p: Px) => void;
    onClick?: () => void;
    onHover: (over: boolean) => void;
}) {
    if (fontSize < 1 || lines.length === 0) return null;
    const lineH = fontSize * OCCUPANCY_LINE_HEIGHT;
    const w = Math.max(...lines.map((l) => estimateTextPx(l, fontSize)));
    const pad = 2;
    // 文字の左上（基準点から見た相対）。center は 1 行目の中央下が基準なので、左上は (-w/2, -fontSize)
    const left = align === 'center' ? -w / 2 : 0;
    const top = align === 'center' ? -fontSize : 0;
    return (
        <Group
            name={OCCUPANCY_LABEL_NAME}
            x={at.x}
            y={at.y}
            draggable={enabled}
            listening={enabled}
            onDragEnd={(ev) => {
                const p = ev.target.position();
                onMoved({ x: p.x, y: p.y });
            }}
            onClick={() => onClick?.()}
            onTap={() => onClick?.()}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            <Rect x={left - pad} y={top - 1} width={w + pad * 2} height={lineH * (lines.length - 1) + fontSize + 2} fill="#ffffff" opacity={0.85} />
            {lines.map((line, i) => (
                <Text
                    key={i}
                    x={left}
                    y={top + lineH * i}
                    text={line}
                    fontSize={fontSize}
                    fontFamily="serif"
                    fill={color}
                    width={w}
                    align={align}
                    listening={false}
                />
            ))}
        </Group>
    );
}

/**
 * 占用範囲の文字の層（1 つのとき＝「路線名　式　約○㎡」／2 つ以上＝範囲に ①② と、まとまり「申請物件…」）。
 * 図形の層（listening=false）とは別に置き、文字だけドラッグで動かせるようにする。位置は図面データに持つ（PDF と同じ位置に出る）
 */
const OccupancyLabelsLayer = memo(function OccupancyLabelsLayer({
    drawing,
    entities,
    geo,
    view,
    selection,
    enabled,
    dispatch,
    toReal,
    onHover,
}: {
    drawing: RoadPermitDrawing;
    entities: DrawingEntity[];
    geo: Geo;
    view: View;
    selection: string[];
    enabled: boolean;
    dispatch: React.Dispatch<EditorAction>;
    toReal: (sx: number, sy: number) => DrawingPoint;
    onHover: (over: boolean) => void;
}) {
    const list = useMemo(() => entities.filter((e): e is Extract<DrawingEntity, { kind: 'occupancy' }> => e.kind === 'occupancy'), [entities]);
    const px = view.pxPerMm;
    const fontSize = OCCUPANCY_TEXT_PAPER_MM * px;
    if (list.length === 0) return null;
    const toS = (p: DrawingPoint) => realToScreen(geo, view, p);
    const noteLines = occupancyNoteLines(list);
    const noteAt = toS(occupancyNoteAt(drawing, list));
    return (
        <Layer listening={enabled}>
            {list.map((e, i) => {
                const c = toS(occupancyLabelAt(e));
                const color = selection.includes(e.id) ? COLOR_SELECTED : DRAWING_LAYER_COLORS[e.layer];
                return (
                    <DraggableLabel
                        key={e.id}
                        // 文字の中ほどが基準点に来るように（基準点は 1 行目の中央下）
                        at={{ x: c.x, y: c.y + fontSize * 0.5 }}
                        lines={[occupancyEntityLabel(e, i, list.length)]}
                        fontSize={fontSize}
                        align="center"
                        color={color}
                        enabled={enabled}
                        onMoved={(p) => {
                            const r = toReal(p.x, p.y - fontSize * 0.5);
                            dispatch({ type: 'setOccupancyLabelAt', id: e.id, at: r });
                        }}
                        onClick={() => dispatch({ type: 'setSelection', ids: [e.id] })}
                        onHover={onHover}
                    />
                );
            })}
            {noteLines.length > 0 && (
                <DraggableLabel
                    at={noteAt}
                    lines={noteLines}
                    fontSize={fontSize}
                    align="left"
                    color="#0f172a"
                    enabled={enabled}
                    onMoved={(p) => dispatch({ type: 'setOccupancyNoteAt', at: toReal(p.x, p.y) })}
                    onHover={onHover}
                />
            )}
        </Layer>
    );
});

/** 凡例の下絵（記号の形を枠に収めて 1 つの path で描く）。cx・cy は枠の中心（px）、size は枠の 1 辺（px） */
function LegendThumb({ geometry, cx, cy, size }: { geometry: Parameters<typeof symbolPolylines>[0]; cx: number; cy: number; size: number }) {
    const bb = symbolBBox(geometry);
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    if (!(span > 0)) return null;
    const k = size / span;
    const mx = (bb.minX + bb.maxX) / 2;
    const my = (bb.minY + bb.maxY) / 2;
    const polys = symbolPolylines(geometry).map((poly) => poly.map((p) => ({ x: cx + (p.x - mx) * k, y: cy - (p.y - my) * k })));
    return (
        <Shape
            sceneFunc={(ctx, shape) => {
                ctx.beginPath();
                for (const poly of polys) {
                    if (poly.length < 2) continue;
                    ctx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
                }
                ctx.strokeShape(shape);
            }}
            stroke="#0f172a"
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
        />
    );
}

/** 図形の層（カーソルが動いただけでは描き直さない） */
const EntitiesLayer = memo(function EntitiesLayer({
    entities,
    geo,
    view,
    selection,
    symbols,
    symbolsLoading,
}: {
    entities: DrawingEntity[];
    geo: Geo;
    view: View;
    selection: string[];
    symbols: RoadPermitSymbolMap;
    symbolsLoading: boolean;
}) {
    const sel = useMemo(() => new Set(selection), [selection]);
    return (
        <Layer listening={false}>
            {entities.map((e) => (
                <EntityShape
                    key={e.id}
                    e={e}
                    geo={geo}
                    view={view}
                    selected={sel.has(e.id)}
                    preview={false}
                    sym={e.kind === 'symbol' ? symbols.get(e.symbolId) : undefined}
                    symbolsLoading={symbolsLoading}
                />
            ))}
        </Layer>
    );
});

/** 用紙・方眼・用紙枠・表題欄などの下敷き */
const PaperLayer = memo(function PaperLayer({
    drawing,
    view,
    showGrid,
    showFrame,
    values,
    symbols,
}: {
    drawing: RoadPermitDrawing;
    view: View;
    showGrid: boolean;
    showFrame: boolean;
    values: RoadPermitValues | null;
    symbols: RoadPermitSymbolMap;
}) {
    const { w, h } = drawingPaperMm(drawing);
    const px = view.pxPerMm;
    const P = (x: number, y: number): Px => ({ x: view.panX + x * px, y: view.panY + (h - y) * px });
    const m = PAPER_MARGIN_MM;

    // 方眼: 用紙 10mm。細かすぎるときは 50mm に間引く
    const grid: number[][] = [];
    if (showGrid) {
        const step = 10 * px >= 8 ? 10 : 50;
        for (let x = step; x < w; x += step) grid.push(flat([P(x, 0), P(x, h)]));
        for (let y = step; y < h; y += step) grid.push(flat([P(0, y), P(w, y)]));
    }

    // 表題欄（右下）の見本。印刷は PDF 側が正（ここは目安）
    const tb = effectiveTitleBlock(drawing.titleBlock, values);
    const rows: [string, string][] = [
        ['図面名', tb.drawingName],
        ['場　所', tb.location],
        ['路線名', tb.routeName],
        ['期　間', tb.period],
        ['縮　尺', `${scaleLabel(drawing.scale)}（${drawing.paper.size}）`],
        ['作　成', tb.author],
    ];
    const tbW = 110;
    const rowH = 6;
    const tbX = w - m - tbW;
    const tbY = m; // 下端
    const fs = 2.2 * px;

    // 凡例（表題欄の上・右寄せ）。印刷は PDF 側が正（ここは目安。幅と行の高さは PDF と同じ）
    const legend = (() => {
        if (!drawing.showLegend) return null;
        const all = legendRows(drawing.entities, symbols, drawing.layers);
        if (all.length === 0) return null;
        const { rows: shownRows, more } = legendVisibleRows(all);
        const lay = legendLayout(shownRows.length + (more > 0 ? 1 : 0));
        const lw = LEGEND_WIDTH_MM;
        const bottom = drawing.showTitleBlock ? tbY + rowH * rows.length : tbY;
        // 1 行＝下絵・名前・数。上限を超えた分は最後の行に「ほか n 種」
        const items = [
            ...shownRows.map((r) => ({ key: r.symbolId, geometry: r.geometry, name: r.name, count: `${r.count} ${r.unit}` })),
            ...(more > 0 ? [{ key: '__more', geometry: null, name: `ほか ${more} 種`, count: '' }] : []),
        ];
        return { items, lay, lw, x: w - m - lw, bottom };
    })();

    // 縮尺の棒（左下）: 用紙で 40〜60mm くらいになる長さ（m 単位で切りのよい値）
    const barM = [1, 2, 5, 10, 20, 25, 50].find((v) => (v * 1000) / drawing.scale >= 40) ?? 50;
    const barMm = (barM * 1000) / drawing.scale;

    return (
        <Layer listening={false}>
            <Rect
                x={view.panX}
                y={view.panY}
                width={w * px}
                height={h * px}
                fill="#ffffff"
                shadowColor="#94a3b8"
                shadowBlur={8}
                shadowOffsetX={2}
                shadowOffsetY={2}
                shadowOpacity={0.6}
            />
            {grid.map((g, i) => (
                <Line key={i} points={g} stroke={COLOR_GRID} strokeWidth={1} />
            ))}
            {showFrame && (
                <Rect x={P(m, h - m).x} y={P(m, h - m).y} width={(w - 2 * m) * px} height={(h - 2 * m) * px} stroke={COLOR_FRAME} strokeWidth={1} />
            )}
            {drawing.showTitleBlock && (
                <Group>
                    <Rect x={P(tbX, tbY + rowH * rows.length).x} y={P(tbX, tbY + rowH * rows.length).y} width={tbW * px} height={rowH * rows.length * px} fill="#ffffff" stroke={COLOR_FRAME} strokeWidth={1} />
                    {rows.map(([label, value], i) => {
                        const top = tbY + rowH * (rows.length - i);
                        const bottom = top - rowH;
                        return (
                            <Group key={label}>
                                {i > 0 && <Line points={flat([P(tbX, top), P(tbX + tbW, top)])} stroke={COLOR_FRAME} strokeWidth={0.8} />}
                                <TextNode at={P(tbX + 2, bottom + 1.8)} text={label} fontSize={fs} rotationDeg={0} align="left" color="#334155" />
                                <TextNode at={P(tbX + 22, bottom + 1.8)} text={value} fontSize={fs} rotationDeg={0} align="left" color="#0f172a" />
                            </Group>
                        );
                    })}
                    <Line points={flat([P(tbX + 19, tbY), P(tbX + 19, tbY + rowH * rows.length)])} stroke={COLOR_FRAME} strokeWidth={0.8} />
                </Group>
            )}
            {legend && (
                <Group>
                    <Rect
                        x={P(legend.x, legend.bottom + legend.lay.heightMm).x}
                        y={P(legend.x, legend.bottom + legend.lay.heightMm).y}
                        width={legend.lw * px}
                        height={legend.lay.heightMm * px}
                        fill="#ffffff"
                        stroke={COLOR_FRAME}
                        strokeWidth={1}
                        opacity={0.9}
                    />
                    <TextNode
                        at={P(legend.x + legend.lw / 2, legend.bottom + legend.lay.heightMm - legend.lay.headerMm / 2 - legend.lay.fontMm * 0.4)}
                        text="凡　例"
                        fontSize={legend.lay.fontMm * px}
                        rotationDeg={0}
                        align="center"
                        color="#334155"
                    />
                    {legend.items.map((item, i) => {
                        const top = legend.bottom + legend.lay.heightMm - legend.lay.headerMm - legend.lay.rowMm * i;
                        const midY = top - legend.lay.rowMm / 2;
                        const base = midY - legend.lay.fontMm * 0.4;
                        const c = P(legend.x + 2 + legend.lay.thumbMm / 2, midY);
                        return (
                            <Group key={item.key}>
                                <Line points={flat([P(legend.x, top), P(legend.x + legend.lw, top)])} stroke={COLOR_FRAME} strokeWidth={0.6} />
                                {item.geometry && <LegendThumb geometry={item.geometry} cx={c.x} cy={c.y} size={legend.lay.thumbMm * px} />}
                                <TextNode at={P(legend.x + legend.lay.thumbMm + 5, base)} text={item.name} fontSize={legend.lay.fontMm * px} rotationDeg={0} align="left" color="#0f172a" />
                                <TextNode at={P(legend.x + legend.lw - 3, base)} text={item.count} fontSize={legend.lay.fontMm * px} rotationDeg={0} align="right" color="#0f172a" />
                            </Group>
                        );
                    })}
                </Group>
            )}
            {drawing.showNorthArrow && (
                <Group>
                    <Circle x={P(m + 15, h - m - 18).x} y={P(m + 15, h - m - 18).y} radius={7 * px} stroke={COLOR_FRAME} strokeWidth={1} />
                    <Line points={flat([P(m + 15, h - m - 25), P(m + 12, h - m - 18), P(m + 15, h - m - 11), P(m + 18, h - m - 18)])} closed fill="#0f172a" />
                    <TextNode at={P(m + 15, h - m - 9)} text="N" fontSize={3 * px} rotationDeg={0} align="center" color="#0f172a" />
                </Group>
            )}
            {drawing.showScaleBar && (
                <Group>
                    <Line points={flat([P(m + 10, m + 8), P(m + 10 + barMm, m + 8)])} stroke="#0f172a" strokeWidth={Math.max(1, 1 * px)} />
                    <Line points={flat([P(m + 10, m + 7), P(m + 10, m + 9.5)])} stroke="#0f172a" strokeWidth={1} />
                    <Line points={flat([P(m + 10 + barMm, m + 7), P(m + 10 + barMm, m + 9.5)])} stroke="#0f172a" strokeWidth={1} />
                    <TextNode at={P(m + 10, m + 3.5)} text="0" fontSize={2 * px} rotationDeg={0} align="center" color="#0f172a" />
                    <TextNode at={P(m + 10 + barMm, m + 3.5)} text={`${barM}m`} fontSize={2 * px} rotationDeg={0} align="center" color="#0f172a" />
                    <TextNode at={P(m + 10 + barMm / 2, m + 10.5)} text={scaleLabel(drawing.scale)} fontSize={2 * px} rotationDeg={0} align="center" color="#0f172a" />
                </Group>
            )}
        </Layer>
    );
});

/** 読取点の印（□=端点・△=中点・×=交点・○=中心） */
function SnapMark({ c, at }: { c: SnapCandidate['kind']; at: Px }) {
    const r = 6;
    const style = { stroke: '#d946ef', strokeWidth: 1.5, listening: false };
    if (c === 'end') return <Rect x={at.x - r} y={at.y - r} width={r * 2} height={r * 2} {...style} />;
    if (c === 'mid') return <Line points={[at.x, at.y - r, at.x + r, at.y + r * 0.8, at.x - r, at.y + r * 0.8]} closed {...style} />;
    if (c === 'center') return <Circle x={at.x} y={at.y} radius={r} {...style} />;
    return (
        <Group listening={false}>
            <Line points={[at.x - r, at.y - r, at.x + r, at.y + r]} {...style} />
            <Line points={[at.x - r, at.y + r, at.x + r, at.y - r]} {...style} />
        </Group>
    );
}

type DragState =
    | { mode: 'pan'; sx: number; sy: number; panX: number; panY: number }
    | { mode: 'left'; sx: number; sy: number; picking: boolean; moved: boolean };

type TouchState =
    | { mode: 'one'; sx: number; sy: number; panX: number; panY: number; moved: boolean }
    | { mode: 'pinch'; dist: number; cx: number; cy: number; view: View }
    | null;

export default function DrawingCanvas({ state, dispatch, values, spaceDown, symbolsLoading = false }: DrawingCanvasProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [rect, setRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const [panning, setPanning] = useState(false);
    // 占用範囲の文字の上にカーソルがある（カーソルを「動かせる」形にする）
    const [labelHover, setLabelHover] = useState(false);
    const dragRef = useRef<DragState | null>(null);
    const touchRef = useRef<TouchState>(null);
    const { drawing, view } = state;

    // 最新の状態をイベントの中から読む（イベントを張り直さないため）
    const stateRef = useRef(state);
    stateRef.current = state;

    // 親の大きさに追従
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const r = entries[0].contentRect;
            setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 最初（と用紙を変えたとき）は用紙が収まる表示にする
    useEffect(() => {
        if (size.w <= 0 || size.h <= 0 || view.initialized) return;
        dispatch({ type: 'setView', patch: { ...fitView(drawing, size.w, size.h), initialized: true } });
    }, [size.w, size.h, view.initialized, drawing, dispatch]);

    // ホイール＝カーソル中心のズーム（ページのスクロールを止めるため passive: false で張る）
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const onWheel = (ev: WheelEvent) => {
            ev.preventDefault();
            const b = el.getBoundingClientRect();
            const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
            dispatch({ type: 'setView', patch: zoomAt(stateRef.current.view, ev.clientX - b.left, ev.clientY - b.top, factor) });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [dispatch]);

    const geo: Geo = useMemo(() => ({ origin: drawing.origin, scale: drawing.scale, paper: drawing.paper }), [drawing.origin, drawing.scale, drawing.paper]);
    const viewPx: View = useMemo(() => ({ pxPerMm: view.pxPerMm, panX: view.panX, panY: view.panY }), [view.pxPerMm, view.panX, view.panY]);
    const shown = useMemo(() => visibleEntities(drawing), [drawing]);
    const tolMm = (SNAP_PX / view.pxPerMm) * drawing.scale;

    const toReal = useCallback((sx: number, sy: number) => screenToReal(stateRef.current.drawing, stateRef.current.view, sx, sy), []);
    const tol = () => (SNAP_PX / stateRef.current.view.pxPerMm) * stateRef.current.drawing.scale;

    const pointer = (ev: KonvaEventObject<MouseEvent>): Px | null => ev.target.getStage()?.getPointerPosition() ?? null;

    const onMouseDown = (ev: KonvaEventObject<MouseEvent>) => {
        const pos = pointer(ev);
        if (!pos) return;
        // キーボード（Esc・Ctrl+Z など）を受けるため、作図画面の外枠に focus を移す
        wrapRef.current?.closest<HTMLElement>('[data-drawing-root]')?.focus();
        // 占用範囲の文字の上で押した＝文字のドラッグ（konva に任せる）。図面のクリックにはしない
        if (ev.evt.button === 0 && !spaceDown && isOccupancyLabelTarget(ev)) return;
        const btn = ev.evt.button;
        if (btn === 1 || (btn === 0 && spaceDown)) {
            ev.evt.preventDefault();
            dragRef.current = { mode: 'pan', sx: pos.x, sy: pos.y, panX: stateRef.current.view.panX, panY: stateRef.current.view.panY };
            setPanning(true);
            return;
        }
        if (btn === 2) {
            // 右クリック＝読取点（近くの端点・中点・交点・中心に吸い付く）
            const cand = snapCandidate(toReal(pos.x, pos.y), visibleEntities(stateRef.current.drawing), tol(), stateRef.current.symbols);
            if (!cand) {
                dispatch({ type: 'setMessage', message: '読取点がありません（図形の端・中点・交点・円の中心の近くで右クリック）' });
                return;
            }
            dispatch({ type: 'point', p: cand.p, snapped: true, tolMm: tol(), additive: ev.evt.shiftKey || ev.evt.ctrlKey });
            return;
        }
        if (btn === 0) {
            dragRef.current = { mode: 'left', sx: pos.x, sy: pos.y, picking: isPickingStage(stateRef.current), moved: false };
        }
    };

    const onMouseMove = (ev: KonvaEventObject<MouseEvent>) => {
        const pos = pointer(ev);
        if (!pos) return;
        dispatch({ type: 'hover', p: toReal(pos.x, pos.y), shift: ev.evt.shiftKey });
        const d = dragRef.current;
        if (!d) return;
        if (d.mode === 'pan') {
            dispatch({ type: 'setView', patch: { panX: d.panX + pos.x - d.sx, panY: d.panY + pos.y - d.sy } });
            return;
        }
        if (Math.hypot(pos.x - d.sx, pos.y - d.sy) > DRAG_PX) d.moved = true;
        if (d.picking && d.moved) setRect({ x1: d.sx, y1: d.sy, x2: pos.x, y2: pos.y });
    };

    const onMouseUp = (ev: KonvaEventObject<MouseEvent>) => {
        const d = dragRef.current;
        dragRef.current = null;
        setPanning(false);
        if (!d || d.mode === 'pan') return;
        const pos = pointer(ev) ?? { x: d.sx, y: d.sy };
        setRect(null);
        const additive = ev.evt.shiftKey || ev.evt.ctrlKey;
        if (d.picking && d.moved) {
            const a = toReal(d.sx, d.sy);
            const b = toReal(pos.x, pos.y);
            dispatch({
                type: 'rectSelect',
                rect: { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) },
                additive,
            });
            return;
        }
        // 左クリック＝自由点（押した位置）
        dispatch({ type: 'point', p: toReal(d.sx, d.sy), shift: ev.evt.shiftKey, tolMm: tol(), additive });
    };

    // ダブルクリック＝コーン列・占用範囲の確定（2 回のクリックは同じ点なので 1 点として扱われる）
    const finishesByDblClick = () => stateRef.current.command === 'coneRow' || (stateRef.current.command === 'occupancy' && stateRef.current.pts.length > 0);
    const onDblClick = (ev: KonvaEventObject<MouseEvent>) => {
        if (ev.evt.button !== 0 || !finishesByDblClick()) return;
        dispatch({ type: 'finish' });
    };
    const onDblTap = () => {
        if (!finishesByDblClick()) return;
        dispatch({ type: 'finish' });
    };

    const onMouseLeave = () => {
        dragRef.current = null;
        setRect(null);
        setPanning(false);
        dispatch({ type: 'hover', p: null });
    };

    // ---- タッチ（タブレット）: 1 本指＝パン（動かさずに離したら点の指示）・2 本指＝ピンチズーム ----
    const touchPos = (t: Touch): Px => {
        const b = wrapRef.current?.getBoundingClientRect();
        return { x: t.clientX - (b?.left ?? 0), y: t.clientY - (b?.top ?? 0) };
    };
    const onTouchStart = (ev: KonvaEventObject<TouchEvent>) => {
        const ts = ev.evt.touches;
        // 占用範囲の文字に触れた＝文字のドラッグ（konva に任せる）。パン・点の指示にはしない
        if (ts.length === 1 && isOccupancyLabelTarget(ev)) {
            touchRef.current = null;
            return;
        }
        if (ts.length >= 2) {
            const a = touchPos(ts[0]);
            const b = touchPos(ts[1]);
            touchRef.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...stateRef.current.view } };
        } else if (ts.length === 1) {
            const p = touchPos(ts[0]);
            touchRef.current = { mode: 'one', sx: p.x, sy: p.y, panX: stateRef.current.view.panX, panY: stateRef.current.view.panY, moved: false };
        }
    };
    const onTouchMove = (ev: KonvaEventObject<TouchEvent>) => {
        const t = touchRef.current;
        if (!t) return;
        ev.evt.preventDefault();
        const ts = ev.evt.touches;
        if (t.mode === 'pinch' && ts.length >= 2) {
            const a = touchPos(ts[0]);
            const b = touchPos(ts[1]);
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            const z = zoomAt({ ...stateRef.current.view, ...t.view }, t.cx, t.cy, dist / t.dist);
            dispatch({ type: 'setView', patch: { pxPerMm: z.pxPerMm, panX: z.panX + cx - t.cx, panY: z.panY + cy - t.cy } });
            return;
        }
        if (t.mode === 'one' && ts.length === 1) {
            const p = touchPos(ts[0]);
            if (Math.hypot(p.x - t.sx, p.y - t.sy) > 8) t.moved = true;
            if (t.moved) dispatch({ type: 'setView', patch: { panX: t.panX + p.x - t.sx, panY: t.panY + p.y - t.sy } });
        }
    };
    const onTouchEnd = () => {
        const t = touchRef.current;
        touchRef.current = null;
        if (t && t.mode === 'one' && !t.moved) {
            dispatch({ type: 'point', p: toReal(t.sx, t.sy), tolMm: tol() * 2 });
        }
    };

    // ---- 重ねて描くもの（ゴム線・読取点の印・カーソル） ----
    const previews = useMemo(() => previewEntities(state), [state]);
    const hoverSnap = useMemo(() => {
        if (!state.cursor) return null;
        return snapCandidate(state.cursor, shown, tolMm, state.symbols);
    }, [state.cursor, shown, tolMm, state.symbols]);
    const cursorPx = state.cursor ? realToScreen(geo, viewPx, state.cursor) : null;

    return (
        <div
            ref={wrapRef}
            className="absolute inset-0 overflow-hidden bg-slate-300 outline-none"
            style={{ touchAction: 'none', cursor: panning ? 'grabbing' : spaceDown ? 'grab' : labelHover ? 'move' : 'crosshair' }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {size.w > 0 && size.h > 0 && (
                <Stage
                    width={size.w}
                    height={size.h}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave}
                    onDblClick={onDblClick}
                    onDblTap={onDblTap}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    onContextMenu={(e) => e.evt.preventDefault()}
                >
                    <PaperLayer drawing={drawing} view={viewPx} showGrid={view.showGrid} showFrame={view.showPaperFrame} values={values} symbols={state.symbols} />
                    <EntitiesLayer
                        entities={shown}
                        geo={geo}
                        view={viewPx}
                        selection={state.selection}
                        symbols={state.symbols}
                        symbolsLoading={symbolsLoading}
                    />
                    {/* 占用範囲の文字（ドラッグで動かせる。Space でパンしている間は動かさない） */}
                    <OccupancyLabelsLayer
                        drawing={drawing}
                        entities={shown}
                        geo={geo}
                        view={viewPx}
                        selection={state.selection}
                        enabled={!spaceDown}
                        dispatch={dispatch}
                        toReal={toReal}
                        onHover={setLabelHover}
                    />
                    <Layer listening={false}>
                        {previews.map((e) => (
                            <EntityShape
                                key={e.id}
                                e={e}
                                geo={geo}
                                view={viewPx}
                                selected={false}
                                preview
                                sym={e.kind === 'symbol' ? state.symbols.get(e.symbolId) : undefined}
                            />
                        ))}
                        {state.pts.map((p, i) => {
                            const s = realToScreen(geo, viewPx, p);
                            return <Rect key={i} x={s.x - 3} y={s.y - 3} width={6} height={6} fill={COLOR_PREVIEW} />;
                        })}
                        {hoverSnap && <SnapMark c={hoverSnap.kind} at={realToScreen(geo, viewPx, hoverSnap.p)} />}
                        {rect && (
                            <Rect
                                x={Math.min(rect.x1, rect.x2)}
                                y={Math.min(rect.y1, rect.y2)}
                                width={Math.abs(rect.x2 - rect.x1)}
                                height={Math.abs(rect.y2 - rect.y1)}
                                stroke={COLOR_SELECTED}
                                dash={[4, 3]}
                                fill="rgba(13,148,136,0.08)"
                            />
                        )}
                        {cursorPx && !panning && (
                            <Group>
                                <Line points={[cursorPx.x - 14, cursorPx.y, cursorPx.x + 14, cursorPx.y]} stroke="#64748b" strokeWidth={1} />
                                <Line points={[cursorPx.x, cursorPx.y - 14, cursorPx.x, cursorPx.y + 14]} stroke="#64748b" strokeWidth={1} />
                            </Group>
                        )}
                    </Layer>
                </Stage>
            )}
        </div>
    );
}
