// react-konva の Stage / Layer でキャンバス描画。
// このファイルは必ず { ssr: false } の dynamic import 経由で使うこと。
'use client';

import React, { useMemo } from 'react';
import { Stage, Layer, Line, Rect, Text, Group } from 'react-konva';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import {
    computeBoundingBox,
    fitToCanvas,
    midpoint,
    perpendicularUnit,
    distance,
} from '@/utils/drawingMath';
import type { Point } from '@/stores/siteSurveySlices/types';

interface DrawingCanvasProps {
    width?: number;
    height?: number;
}

const COLOR_LINE = '#0f766e';
const COLOR_FILL = 'rgba(13, 148, 136, 0.1)';
const COLOR_LABEL = '#134e4a';
const COLOR_GRID = '#e2e8f0';
const COLOR_POINT = '#0f766e';
const COLOR_POINT_ACTIVE = '#0d9488';

export default function DrawingCanvas({ width = 600, height = 480 }: DrawingCanvasProps) {
    const data = useDrawingStore(s => s.data);
    const currentSectionId = useDrawingStore(s => s.currentSectionId);
    const currentPointIndex = useDrawingStore(s => s.currentPointIndex);

    const section = data.sections.find(s => s.id === currentSectionId) ?? data.sections[0];
    const points = section?.polygon.points ?? [];
    const closed = section?.polygon.closed ?? false;

    const fit = useMemo(() => {
        const bbox = computeBoundingBox(points);
        return fitToCanvas(bbox, width, height, 60);
    }, [points, width, height]);

    const toPx = (p: Point) => ({
        x: p.x * fit.scale + fit.offsetX,
        y: p.y * fit.scale + fit.offsetY,
    });

    const flatPoints = points.flatMap(p => {
        const px = toPx(p);
        return [px.x, px.y];
    });

    // 1m ごとの方眼背景
    const gridLines: number[][] = [];
    {
        const step = 1000; // mm
        const bbox = computeBoundingBox(points);
        const minX = Math.floor(bbox.minX / step) * step - step;
        const maxX = Math.ceil(bbox.maxX / step) * step + step;
        const minY = Math.floor(bbox.minY / step) * step - step;
        const maxY = Math.ceil(bbox.maxY / step) * step + step;
        for (let x = minX; x <= maxX; x += step) {
            const a = toPx({ x, y: minY });
            const b = toPx({ x, y: maxY });
            gridLines.push([a.x, a.y, b.x, b.y]);
        }
        for (let y = minY; y <= maxY; y += step) {
            const a = toPx({ x: minX, y });
            const b = toPx({ x: maxX, y });
            gridLines.push([a.x, a.y, b.x, b.y]);
        }
    }

    // 寸法ラベル: 各辺の中点に長さ表示 + 短いティック線
    const wallSegments: Array<{
        start: Point;
        end: Point;
        lengthMm: number;
        labelX: number;
        labelY: number;
        tick: { x1: number; y1: number; x2: number; y2: number };
    }> = [];
    if (points.length >= 2) {
        const segCount = closed ? points.length : points.length - 1;
        for (let i = 0; i < segCount; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const lengthMm = distance(a, b);
            const mid = midpoint(a, b);
            const perp = perpendicularUnit(a, b);
            const labelOffsetMm = 200 / fit.scale; // 約 20px 外側
            const labelMm = { x: mid.x + perp.x * labelOffsetMm, y: mid.y + perp.y * labelOffsetMm };
            const labelPx = toPx(labelMm);
            const tickStartPx = toPx(mid);
            const tickEndMm = { x: mid.x + perp.x * (labelOffsetMm * 0.4), y: mid.y + perp.y * (labelOffsetMm * 0.4) };
            const tickEndPx = toPx(tickEndMm);
            wallSegments.push({
                start: a,
                end: b,
                lengthMm,
                labelX: labelPx.x,
                labelY: labelPx.y,
                tick: { x1: tickStartPx.x, y1: tickStartPx.y, x2: tickEndPx.x, y2: tickEndPx.y },
            });
        }
    }

    return (
        <Stage width={width} height={height} style={{ background: '#f8fafc', borderRadius: 12 }}>
            <Layer listening={false}>
                {gridLines.map((g, i) => (
                    <Line key={`g-${i}`} points={g} stroke={COLOR_GRID} strokeWidth={1} />
                ))}
            </Layer>

            <Layer listening={false}>
                {points.length >= 3 && closed && (
                    <Line points={flatPoints} closed fill={COLOR_FILL} />
                )}
                {points.length >= 2 && (
                    <Line
                        points={flatPoints}
                        stroke={COLOR_LINE}
                        strokeWidth={2.5}
                        closed={closed}
                        lineJoin="round"
                        lineCap="round"
                    />
                )}

                {wallSegments.map((w, i) => (
                    <Group key={`w-${i}`}>
                        <Line
                            points={[w.tick.x1, w.tick.y1, w.tick.x2, w.tick.y2]}
                            stroke={COLOR_LABEL}
                            strokeWidth={1}
                        />
                        <Text
                            x={w.labelX - 30}
                            y={w.labelY - 8}
                            width={60}
                            align="center"
                            text={Math.round(w.lengthMm).toString()}
                            fontSize={12}
                            fontStyle="500"
                            fill={COLOR_LABEL}
                        />
                    </Group>
                ))}

                {points.map((p, i) => {
                    const px = toPx(p);
                    const isActive = i === currentPointIndex;
                    if (isActive) {
                        return (
                            <Rect
                                key={`p-${i}`}
                                x={px.x - 6}
                                y={px.y - 6}
                                width={12}
                                height={12}
                                cornerRadius={3}
                                fill={COLOR_POINT_ACTIVE}
                            />
                        );
                    }
                    // クロス十字
                    return (
                        <Group key={`p-${i}`}>
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
            </Layer>
        </Stage>
    );
}
