// react-konva の Stage / Layer でキャンバス描画。
// このファイルは必ず { ssr: false } の dynamic import 経由で使うこと。
'use client';

import React, { useMemo } from 'react';
import { Stage, Layer, Line, Rect, Text, Group, Label, Tag } from 'react-konva';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import {
    computeBoundingBox,
    fitToCanvas,
    midpoint,
    perpendicularUnit,
    distance,
    pxToMm,
    chooseGridSpacing,
    getWalls,
} from '@/utils/drawingMath';
import type { Point, CanvasFit, Marker, MarkerColor } from '@/stores/siteSurveySlices/types';

export const MARKER_COLORS: Record<MarkerColor, string> = {
    red: '#fca5a5',
    blue: '#93c5fd',
    green: '#86efac',
    yellow: '#fcd34d',
};

interface GhostLine {
    fromPx: { x: number; y: number };
    toPx: { x: number; y: number };
    label?: string;
}

interface DrawingCanvasProps {
    width?: number;
    height?: number;
    fit?: CanvasFit;
    ghost?: GhostLine | null;
    selectedOpening?: { sectionId: string; openingIndex: number } | null;
    markers?: Marker[];
    previewMarker?: { points: Point[]; color: MarkerColor } | null;
    selectedMarkerId?: string | null;
}

const COLOR_LINE = '#0f766e';
const COLOR_FILL = 'rgba(13, 148, 136, 0.1)';
const COLOR_LABEL = '#134e4a';
const COLOR_GRID = '#c4ccd6';
const GRID_STROKE = 1.0;
const COLOR_POINT = '#0f766e';
const COLOR_POINT_ACTIVE = '#0d9488';

export default function DrawingCanvas({ width = 600, height = 480, fit: fitProp, ghost = null, selectedOpening = null, markers, previewMarker = null, selectedMarkerId = null }: DrawingCanvasProps) {
    const data = useDrawingStore(s => s.data);
    const currentSectionId = useDrawingStore(s => s.currentSectionId);
    const currentPointIndex = useDrawingStore(s => s.currentPointIndex);

    const sections = data.sections;
    const allPoints = useMemo(
        () => sections.flatMap(s => s.polygon.points),
        [sections],
    );

    const fit = useMemo(() => {
        if (fitProp) return fitProp;
        const bbox = computeBoundingBox(allPoints);
        return fitToCanvas(bbox, width, height, 60);
    }, [fitProp, allPoints, width, height]);

    const toPx = (p: Point) => ({
        x: p.x * fit.scale + fit.offsetX,
        y: p.y * fit.scale + fit.offsetY,
    });

    // 適応的グリッド: ズームに応じて間隔切替、画面の可視 mm 範囲に対して描画
    const gridLayers = (() => {
        const { minor } = chooseGridSpacing(fit.scale);
        const padMm = minor * 5;
        const topLeftMm = pxToMm({ x: 0, y: 0 }, fit);
        const bottomRightMm = pxToMm({ x: width, y: height }, fit);
        const minX = Math.floor((topLeftMm.x - padMm) / minor) * minor;
        const maxX = Math.ceil((bottomRightMm.x + padMm) / minor) * minor;
        const minY = Math.floor((topLeftMm.y - padMm) / minor) * minor;
        const maxY = Math.ceil((bottomRightMm.y + padMm) / minor) * minor;

        const lines: number[][] = [];
        for (let x = minX; x <= maxX; x += minor) {
            const a = toPx({ x, y: minY });
            const b = toPx({ x, y: maxY });
            lines.push([a.x, a.y, b.x, b.y]);
        }
        for (let y = minY; y <= maxY; y += minor) {
            const a = toPx({ x: minX, y });
            const b = toPx({ x: maxX, y });
            lines.push([a.x, a.y, b.x, b.y]);
        }
        return lines;
    })();

    // 寸法ラベル: 各セクションの各辺
    interface WallSeg {
        sectionId: string;
        i: number;
        lengthMm: number;
        labelX: number;
        labelY: number;
        tick: { x1: number; y1: number; x2: number; y2: number };
    }
    const wallSegmentsBySection: Record<string, WallSeg[]> = {};
    for (const sec of sections) {
        const pts = sec.polygon.points;
        const cls = sec.polygon.closed;
        const segs: WallSeg[] = [];
        if (pts.length >= 2) {
            const segCount = cls ? pts.length : pts.length - 1;
            for (let i = 0; i < segCount; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                const lengthMm = distance(a, b);
                const mid = midpoint(a, b);
                const perp = perpendicularUnit(a, b);
                const LABEL_OFFSET_PX = 14;
                const labelOffsetMm = LABEL_OFFSET_PX / fit.scale;
                const labelMm = {
                    x: mid.x + perp.x * labelOffsetMm,
                    y: mid.y + perp.y * labelOffsetMm,
                };
                const labelPx = toPx(labelMm);
                const tickStartPx = toPx(mid);
                const tickEndMm = {
                    x: mid.x + perp.x * (labelOffsetMm * 0.5),
                    y: mid.y + perp.y * (labelOffsetMm * 0.5),
                };
                const tickEndPx = toPx(tickEndMm);
                segs.push({
                    sectionId: sec.id,
                    i,
                    lengthMm,
                    labelX: labelPx.x,
                    labelY: labelPx.y,
                    tick: { x1: tickStartPx.x, y1: tickStartPx.y, x2: tickEndPx.x, y2: tickEndPx.y },
                });
            }
        }
        wallSegmentsBySection[sec.id] = segs;
    }

    return (
        <Stage width={width} height={height} style={{ background: '#f8fafc', borderRadius: 12 }}>
            <Layer listening={false}>
                {gridLayers.map((g, i) => (
                    <Line key={`g-${i}`} points={g} stroke={COLOR_GRID} strokeWidth={GRID_STROKE} />
                ))}
            </Layer>

            <Layer listening={false}>
                {sections.map((sec) => {
                    const pts = sec.polygon.points;
                    const cls = sec.polygon.closed;
                    if (pts.length === 0) return null;
                    const flat = pts.flatMap((p) => {
                        const px = toPx(p);
                        return [px.x, px.y];
                    });
                    const isActiveSection = sec.id === currentSectionId;
                    const segs = wallSegmentsBySection[sec.id] ?? [];
                    return (
                        <Group key={sec.id}>
                            {pts.length >= 3 && cls && (
                                <Line points={flat} closed fill={COLOR_FILL} />
                            )}
                            {pts.length >= 2 && (
                                <Line
                                    points={flat}
                                    stroke={COLOR_LINE}
                                    strokeWidth={2.5}
                                    closed={cls}
                                    lineJoin="round"
                                    lineCap="round"
                                />
                            )}

                            {segs.map((w) => {
                                const txt = Math.round(w.lengthMm).toString();
                                const approxW = txt.length * 7 + 6;
                                const approxH = 12 + 6;
                                return (
                                    <Group key={`w-${sec.id}-${w.i}`}>
                                        <Line
                                            points={[w.tick.x1, w.tick.y1, w.tick.x2, w.tick.y2]}
                                            stroke={COLOR_LABEL}
                                            strokeWidth={1}
                                        />
                                        <Label
                                            x={w.labelX}
                                            y={w.labelY}
                                            offsetX={approxW / 2}
                                            offsetY={approxH / 2}
                                        >
                                            <Tag
                                                fill="#ffffff"
                                                stroke={COLOR_LABEL}
                                                strokeWidth={0.5}
                                                cornerRadius={3}
                                                opacity={0.95}
                                            />
                                            <Text
                                                text={txt}
                                                fontSize={12}
                                                fontStyle="600"
                                                fill={COLOR_LABEL}
                                                padding={3}
                                                align="center"
                                            />
                                        </Label>
                                    </Group>
                                );
                            })}

                            {pts.map((p, i) => {
                                const px = toPx(p);
                                const isActivePoint = isActiveSection && i === currentPointIndex;
                                if (isActivePoint) {
                                    return (
                                        <Rect
                                            key={`p-${sec.id}-${i}`}
                                            x={px.x - 6}
                                            y={px.y - 6}
                                            width={12}
                                            height={12}
                                            cornerRadius={3}
                                            fill={COLOR_POINT_ACTIVE}
                                        />
                                    );
                                }
                                return (
                                    <Group key={`p-${sec.id}-${i}`}>
                                        <Line
                                            points={[px.x - 5, px.y, px.x + 5, px.y]}
                                            stroke={COLOR_POINT}
                                            strokeWidth={1.5}
                                        />
                                        <Line
                                            points={[px.x, px.y - 5, px.x, px.y + 5]}
                                            stroke={COLOR_POINT}
                                            strokeWidth={1.5}
                                        />
                                    </Group>
                                );
                            })}
                        </Group>
                    );
                })}
            </Layer>

            <Layer listening={false}>
                {sections.map((sec) => {
                    const walls = getWalls(sec);
                    return sec.openings.map((op, opIdx) => {
                        const wall = walls.find((w) => w.wallIndex === op.wallIndex);
                        if (!wall || wall.length === 0) return null;
                        const centerMm = op.position * wall.length;
                        const startMm = Math.max(0, centerMm - op.width / 2);
                        const endMm = Math.min(wall.length, centerMm + op.width / 2);
                        const tStart = startMm / wall.length;
                        const tEnd = endMm / wall.length;
                        const sx = wall.a.x + (wall.b.x - wall.a.x) * tStart;
                        const sy = wall.a.y + (wall.b.y - wall.a.y) * tStart;
                        const ex = wall.a.x + (wall.b.x - wall.a.x) * tEnd;
                        const ey = wall.a.y + (wall.b.y - wall.a.y) * tEnd;
                        const sPx = toPx({ x: sx, y: sy });
                        const ePx = toPx({ x: ex, y: ey });
                        const midPx = { x: (sPx.x + ePx.x) / 2, y: (sPx.y + ePx.y) / 2 };
                        const isSelected =
                            selectedOpening !== null &&
                            selectedOpening.sectionId === sec.id &&
                            selectedOpening.openingIndex === opIdx;
                        const widthText = Math.round(op.width).toString();
                        const approxW = widthText.length * 7 + 6;
                        const approxH = 12 + 6;
                        return (
                            <Group key={`op-${sec.id}-${opIdx}`}>
                                <Line
                                    points={[sPx.x, sPx.y, ePx.x, ePx.y]}
                                    stroke="#dc2626"
                                    strokeWidth={isSelected ? 8 : 6}
                                    dash={[10, 6]}
                                    lineCap="round"
                                    shadowBlur={isSelected ? 8 : 0}
                                    shadowColor="rgba(220, 38, 38, 0.5)"
                                />
                                <Label
                                    x={midPx.x}
                                    y={midPx.y}
                                    offsetX={approxW / 2}
                                    offsetY={approxH / 2}
                                >
                                    <Tag
                                        fill="#ffffff"
                                        stroke="#dc2626"
                                        strokeWidth={0.5}
                                        cornerRadius={3}
                                        opacity={0.95}
                                    />
                                    <Text
                                        text={widthText}
                                        fontSize={12}
                                        fontStyle="600"
                                        fill="#dc2626"
                                        padding={3}
                                        align="center"
                                    />
                                </Label>
                            </Group>
                        );
                    });
                })}
            </Layer>

            <Layer listening={false}>
                {(markers ?? data.markers ?? []).map((m) => {
                    const flat = m.points.flatMap((p) => {
                        const px = toPx(p);
                        return [px.x, px.y];
                    });
                    const isSelected = selectedMarkerId === m.id;
                    return (
                        <Line
                            key={m.id}
                            points={flat}
                            stroke={MARKER_COLORS[m.color]}
                            strokeWidth={isSelected ? 8 : 6}
                            opacity={0.6}
                            lineCap="round"
                            lineJoin="round"
                            shadowBlur={isSelected ? 8 : 0}
                            shadowColor={MARKER_COLORS[m.color]}
                        />
                    );
                })}
                {previewMarker && previewMarker.points.length >= 2 && (
                    <Line
                        points={previewMarker.points.flatMap((p) => {
                            const px = toPx(p);
                            return [px.x, px.y];
                        })}
                        stroke={MARKER_COLORS[previewMarker.color]}
                        strokeWidth={6}
                        opacity={0.4}
                        lineCap="round"
                        lineJoin="round"
                    />
                )}
            </Layer>

            {ghost && (
                <Layer listening={false}>
                    <Line
                        points={[ghost.fromPx.x, ghost.fromPx.y, ghost.toPx.x, ghost.toPx.y]}
                        stroke={COLOR_POINT_ACTIVE}
                        strokeWidth={2}
                        opacity={0.6}
                        dash={[8, 6]}
                        lineCap="round"
                    />
                </Layer>
            )}
        </Stage>
    );
}
