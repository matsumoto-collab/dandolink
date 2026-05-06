'use client';

import React, { useCallback, useRef } from 'react';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import { pxToMm, getWalls, distancePointToSegment } from '@/utils/drawingMath';
import type { CanvasFit, Point } from '@/stores/siteSurveySlices/types';

const PAN_THRESHOLD_PX = 8;
const HIT_RADIUS_PX = 20;

interface OpeningInputControllerProps {
    width: number;
    height: number;
    fit: CanvasFit;
    onPan: (deltaMm: { x: number; y: number }) => void;
    onRequestNewOpening: (
        sectionId: string,
        wallIndex: number,
        tapMm: { x: number; y: number },
    ) => void;
    onRequestEditOpening: (sectionId: string, openingIndex: number) => void;
    sheetOpen?: boolean;
}

interface DragState {
    startPx: { x: number; y: number };
    lastPx: { x: number; y: number };
    pointerId: number;
    isPanning: boolean;
}

export default function OpeningInputController({
    width,
    height,
    fit,
    onPan,
    onRequestNewOpening,
    onRequestEditOpening,
    sheetOpen = false,
}: OpeningInputControllerProps) {
    const sections = useDrawingStore((s) => s.data.sections);
    const overlayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);

    const findOpeningHit = useCallback(
        (mm: Point): { sectionId: string; openingIndex: number } | null => {
            const hitMm = HIT_RADIUS_PX / fit.scale;
            for (const sec of sections) {
                const walls = getWalls(sec);
                for (let i = 0; i < sec.openings.length; i++) {
                    const op = sec.openings[i];
                    const wall = walls.find((w) => w.wallIndex === op.wallIndex);
                    if (!wall || wall.length === 0) continue;
                    const t = op.position;
                    const cx = wall.a.x + (wall.b.x - wall.a.x) * t;
                    const cy = wall.a.y + (wall.b.y - wall.a.y) * t;
                    if (Math.hypot(mm.x - cx, mm.y - cy) <= Math.max(hitMm, op.width / 2)) {
                        return { sectionId: sec.id, openingIndex: i };
                    }
                }
            }
            return null;
        },
        [sections, fit],
    );

    const findWallHit = useCallback(
        (mm: Point): { sectionId: string; wallIndex: number } | null => {
            const hitMm = HIT_RADIUS_PX / fit.scale;
            let best: { sectionId: string; wallIndex: number; dist: number } | null = null;
            for (const sec of sections) {
                const walls = getWalls(sec);
                for (const w of walls) {
                    const { distance: d } = distancePointToSegment(mm, w.a, w.b);
                    if (d <= hitMm && (best === null || d < best.dist)) {
                        best = { sectionId: sec.id, wallIndex: w.wallIndex, dist: d };
                    }
                }
            }
            return best ? { sectionId: best.sectionId, wallIndex: best.wallIndex } : null;
        },
        [sections, fit],
    );

    const getLocalPx = (e: React.PointerEvent) => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (sheetOpen) return;
        const px = getLocalPx(e);
        dragRef.current = {
            startPx: px,
            lastPx: px,
            pointerId: e.pointerId,
            isPanning: false,
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const px = getLocalPx(e);
        const totalDist = Math.hypot(px.x - drag.startPx.x, px.y - drag.startPx.y);

        if (!drag.isPanning && totalDist > PAN_THRESHOLD_PX) {
            drag.isPanning = true;
        }

        if (drag.isPanning) {
            const incDx = px.x - drag.lastPx.x;
            const incDy = px.y - drag.lastPx.y;
            onPan({ x: -incDx / fit.scale, y: -incDy / fit.scale });
            drag.lastPx = px;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        dragRef.current = null;

        if (drag.isPanning) return;
        if (sheetOpen) return;

        const px = getLocalPx(e);
        const mm = pxToMm(px, fit);

        const opHit = findOpeningHit(mm);
        if (opHit) {
            onRequestEditOpening(opHit.sectionId, opHit.openingIndex);
            return;
        }
        const wallHit = findWallHit(mm);
        if (wallHit) {
            onRequestNewOpening(wallHit.sectionId, wallHit.wallIndex, mm);
        }
    };

    const handlePointerCancel = (e: React.PointerEvent) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    };

    return (
        <div
            ref={overlayRef}
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
            }}
        />
    );
}
