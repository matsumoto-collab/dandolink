'use client';

import React, { useRef } from 'react';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import { snapToGrid, pxToMm, distancePointToSegment } from '@/utils/drawingMath';
import type { CanvasFit, Point, Marker } from '@/stores/siteSurveySlices/types';

interface MarkerInputControllerProps {
    width: number;
    height: number;
    fit: CanvasFit;
    onPreviewMarker: (points: Point[] | null) => void;
    onCommitMarker: (points: Point[]) => void;
    onTapMarker: (markerId: string) => void;
    onLongPressMarker: (markerId: string) => void;
    onExtendMarker: (markerId: string, fromStart: boolean, endMm: Point) => void;
    sheetOpen?: boolean;
}

const MOVE_THRESHOLD_PX = 8;
const LONG_PRESS_MS = 500;
const HIT_SEGMENT_PX = 20;
const HIT_ENDPOINT_PX = 30;

export default function MarkerInputController({
    width,
    height,
    fit,
    onPreviewMarker,
    onCommitMarker,
    onTapMarker,
    onLongPressMarker,
    onExtendMarker,
    sheetOpen = false,
}: MarkerInputControllerProps) {
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const hitMarkerIdRef = useRef<string | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressFiredRef = useRef<boolean>(false);
    const isDrawingRef = useRef<boolean>(false);
    const dragStartMmRef = useRef<Point | null>(null);
    const dragEndMmRef = useRef<Point | null>(null);
    const axisLockedRef = useRef<'h' | 'v' | null>(null);
    const extendingFromRef = useRef<{
        markerId: string;
        fromStart: boolean;
        startPoint: Point;
    } | null>(null);

    function computeEndMm(start: Point, currentMm: Point, axis: 'h' | 'v'): Point {
        if (axis === 'h') {
            const snapped = snapToGrid({ x: currentMm.x, y: start.y });
            return { x: snapped.x, y: start.y };
        } else {
            const snapped = snapToGrid({ x: start.x, y: currentMm.y });
            return { x: start.x, y: snapped.y };
        }
    }

    function hitEndpoint(
        tapMm: Point,
        markers: Marker[],
        hitMm: number,
    ): { markerId: string; fromStart: boolean; startPoint: Point } | null {
        for (const m of markers) {
            if (m.points.length === 0) continue;
            const first = m.points[0];
            if (Math.hypot(tapMm.x - first.x, tapMm.y - first.y) < hitMm) {
                return { markerId: m.id, fromStart: true, startPoint: first };
            }
            const last = m.points[m.points.length - 1];
            if (Math.hypot(tapMm.x - last.x, tapMm.y - last.y) < hitMm) {
                return { markerId: m.id, fromStart: false, startPoint: last };
            }
        }
        return null;
    }

    const clearLongPress = () => {
        if (longPressTimerRef.current !== null) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const resetState = () => {
        isDrawingRef.current = false;
        hitMarkerIdRef.current = null;
        pointerDownPosRef.current = null;
        longPressFiredRef.current = false;
        axisLockedRef.current = null;
        dragStartMmRef.current = null;
        dragEndMmRef.current = null;
        extendingFromRef.current = null;
        clearLongPress();
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (sheetOpen) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        pointerDownPosRef.current = local;
        const tapMm = pxToMm(local, fit);
        const hitSegmentMm = HIT_SEGMENT_PX / fit.scale;
        const hitEndpointMm = HIT_ENDPOINT_PX / fit.scale;

        const markers = useDrawingStore.getState().data.markers;

        // ① 端点ヒットを最優先
        const epHit = hitEndpoint(tapMm, markers, hitEndpointMm);

        // ② 次にセグメントヒット
        let segHitId: string | null = null;
        if (!epHit) {
            let bestDist = Infinity;
            for (const m of markers) {
                for (let i = 0; i < m.points.length - 1; i++) {
                    const { distance } = distancePointToSegment(tapMm, m.points[i], m.points[i + 1]);
                    if (distance < bestDist && distance < hitSegmentMm) {
                        bestDist = distance;
                        segHitId = m.id;
                    }
                }
            }
        }

        hitMarkerIdRef.current = epHit?.markerId ?? segHitId;
        extendingFromRef.current = epHit;
        longPressFiredRef.current = false;

        if (hitMarkerIdRef.current) {
            longPressTimerRef.current = window.setTimeout(() => {
                longPressFiredRef.current = true;
                onLongPressMarker(hitMarkerIdRef.current!);
            }, LONG_PRESS_MS);
            if (epHit) {
                dragStartMmRef.current = epHit.startPoint;
                dragEndMmRef.current = epHit.startPoint;
                axisLockedRef.current = null;
                // isDrawingRef は移動を検知してから true に昇格
            }
        } else {
            const snapped = snapToGrid(tapMm);
            dragStartMmRef.current = snapped;
            dragEndMmRef.current = snapped;
            axisLockedRef.current = null;
            isDrawingRef.current = true;
            onPreviewMarker([snapped]);
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerDownPosRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const dx = local.x - pointerDownPosRef.current.x;
        const dy = local.y - pointerDownPosRef.current.y;
        const movedPx = Math.hypot(dx, dy);

        if (hitMarkerIdRef.current) {
            if (movedPx > MOVE_THRESHOLD_PX) {
                clearLongPress();
                if (extendingFromRef.current) {
                    // 端点ヒット → 継続描画モードに昇格
                    isDrawingRef.current = true;
                } else {
                    // セグメントヒット → 描画はせず、何もしない
                    hitMarkerIdRef.current = null;
                }
            }
            if (!isDrawingRef.current) return;
        }

        if (isDrawingRef.current && dragStartMmRef.current) {
            if (!axisLockedRef.current && movedPx > MOVE_THRESHOLD_PX) {
                axisLockedRef.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
            }
            if (axisLockedRef.current) {
                const currentMm = pxToMm(local, fit);
                const endMm = computeEndMm(dragStartMmRef.current, currentMm, axisLockedRef.current);
                dragEndMmRef.current = endMm;
                onPreviewMarker([dragStartMmRef.current, endMm]);
            }
        }
    };

    const handlePointerUp = (_e: React.PointerEvent<HTMLDivElement>) => {
        clearLongPress();

        const wasExtending = !!extendingFromRef.current && isDrawingRef.current;

        if (
            hitMarkerIdRef.current &&
            !longPressFiredRef.current &&
            !isDrawingRef.current
        ) {
            onTapMarker(hitMarkerIdRef.current);
        } else if (
            wasExtending &&
            axisLockedRef.current &&
            dragStartMmRef.current &&
            dragEndMmRef.current &&
            extendingFromRef.current
        ) {
            const start = dragStartMmRef.current;
            const end = dragEndMmRef.current;
            if (start.x !== end.x || start.y !== end.y) {
                onExtendMarker(
                    extendingFromRef.current.markerId,
                    extendingFromRef.current.fromStart,
                    end,
                );
            }
        } else if (
            isDrawingRef.current &&
            axisLockedRef.current &&
            dragStartMmRef.current &&
            dragEndMmRef.current &&
            !extendingFromRef.current
        ) {
            const start = dragStartMmRef.current;
            const end = dragEndMmRef.current;
            if (start.x !== end.x || start.y !== end.y) {
                onCommitMarker([start, end]);
            }
        }
        onPreviewMarker(null);
        resetState();
    };

    const handlePointerCancel = (_e: React.PointerEvent<HTMLDivElement>) => {
        onPreviewMarker(null);
        resetState();
    };

    return (
        <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className="absolute inset-0"
            style={{
                width,
                height,
                touchAction: 'none',
                cursor: 'crosshair',
                pointerEvents: 'auto',
            }}
        />
    );
}
