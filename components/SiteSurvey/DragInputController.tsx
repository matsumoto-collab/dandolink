'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import {
    snapTo8Dir,
    directionVector,
    pxToMm,
    mmToPx,
    canCloseAt,
    snapToGrid,
} from '@/utils/drawingMath';
import LengthInputSheet from './LengthInputSheet';
import type { CanvasFit, Direction, Point } from '@/stores/siteSurveySlices/types';

interface DragInputControllerProps {
    width: number;
    height: number;
    fit: CanvasFit;
    onGhostChange: (ghost: {
        fromPx: { x: number; y: number };
        toPx: { x: number; y: number };
        label?: string;
    } | null) => void;
}

const POINT_HIT_RADIUS_PX = 22; // 指で押さえやすいタップヒット半径
const TAP_THRESHOLD_PX = 15;
const CLOSE_THRESHOLD_MM = 800;

interface DragState {
    startPointIndex: number;
    startPx: { x: number; y: number };
    pointerId: number;
}

interface PendingSheet {
    direction: Direction;
    estimatedLengthMm: number;
    closing: boolean;
    fromPointIndex: number;
}

export default function DragInputController({ width, height, fit, onGhostChange }: DragInputControllerProps) {
    const data = useDrawingStore((s) => s.data);
    const currentSectionId = useDrawingStore((s) => s.currentSectionId);
    const setStartPoint = useDrawingStore((s) => s.setStartPoint);
    const addWall = useDrawingStore((s) => s.addWall);
    const closePolygon = useDrawingStore((s) => s.closePolygon);
    const setCurrentPointIndex = useDrawingStore((s) => s.setCurrentPointIndex);

    const section = data.sections.find((s) => s.id === currentSectionId) ?? data.sections[0];
    const points = section?.polygon.points ?? [];
    const closed = section?.polygon.closed ?? false;

    const overlayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const [labelPos, setLabelPos] = useState<{ x: number; y: number; text: string } | null>(null);
    const [pending, setPending] = useState<PendingSheet | null>(null);

    const getLocalPx = useCallback((e: React.PointerEvent | PointerEvent) => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }, []);

    const findPointAt = useCallback(
        (px: { x: number; y: number }): number | null => {
            for (let i = 0; i < points.length; i++) {
                const pp = mmToPx(points[i], fit);
                if (Math.hypot(pp.x - px.x, pp.y - px.y) <= POINT_HIT_RADIUS_PX) {
                    return i;
                }
            }
            return null;
        },
        [points, fit],
    );

    const handlePointerDown = (e: React.PointerEvent) => {
        if (closed || pending) return;
        const px = getLocalPx(e);
        const hit = findPointAt(px);
        if (hit === null) {
            // 既存点がない場合: 開始点配置（点が無いキャンバス時のみ）
            return;
        }
        // ドラッグ起点として記録
        (e.target as Element).setPointerCapture?.(e.pointerId);
        dragRef.current = { startPointIndex: hit, startPx: mmToPx(points[hit], fit), pointerId: e.pointerId };
        setCurrentPointIndex(hit);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const px = getLocalPx(e);
        const dx = px.x - drag.startPx.x;
        const dy = px.y - drag.startPx.y;
        if (Math.hypot(dx, dy) < TAP_THRESHOLD_PX) {
            onGhostChange(null);
            setLabelPos(null);
            return;
        }
        const dir = snapTo8Dir(dx, dy);
        const v = directionVector(dir);
        // 指距離（px）を mm に変換
        const dragMm = Math.hypot(dx, dy) / fit.scale;
        const startMm = points[drag.startPointIndex];
        const endMm: Point = { x: startMm.x + v.dx * dragMm, y: startMm.y + v.dy * dragMm };
        const endPx = mmToPx(endMm, fit);
        onGhostChange({ fromPx: drag.startPx, toPx: endPx });

        const labelY = px.y < 60 ? px.y + 40 : px.y - 40;
        setLabelPos({ x: px.x, y: labelY, text: `${dirArrow(dir)} ${Math.round(dragMm)}mm` });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        dragRef.current = null;
        const px = getLocalPx(e);
        const dx = px.x - drag.startPx.x;
        const dy = px.y - drag.startPx.y;
        const distPx = Math.hypot(dx, dy);
        onGhostChange(null);
        setLabelPos(null);

        if (distPx < TAP_THRESHOLD_PX) {
            // タップ扱い → 起点切替のみ（addWall は出さない）
            return;
        }

        const dir = snapTo8Dir(dx, dy);
        const v = directionVector(dir);
        const dragMm = distPx / fit.scale;
        const startMm = points[drag.startPointIndex];
        const candidate: Point = { x: startMm.x + v.dx * dragMm, y: startMm.y + v.dy * dragMm };

        const willClose = section ? canCloseAt(section, candidate, CLOSE_THRESHOLD_MM) : false;

        setPending({
            direction: dir,
            estimatedLengthMm: dragMm,
            closing: willClose,
            fromPointIndex: drag.startPointIndex,
        });
    };

    const handlePointerCancel = (e: React.PointerEvent) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
        onGhostChange(null);
        setLabelPos(null);
    };

    // 空キャンバス時のクリックで開始点配置（onClick だと pointerdown→up シーケンスでも動く）
    const handleClick = (e: React.MouseEvent) => {
        if (closed || pending) return;
        if (points.length > 0) return;
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const mm = snapToGrid(pxToMm(px, fit));
        setStartPoint(mm.x, mm.y);
    };

    const onSheetCancel = () => setPending(null);
    const onSheetConfirm = (lengthMm: number) => {
        if (!pending) return;
        if (pending.closing) {
            closePolygon();
        } else {
            addWall(pending.direction, lengthMm);
        }
        setPending(null);
    };

    return (
        <>
            <div
                ref={overlayRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onClick={handleClick}
                className="absolute inset-0"
                style={{
                    width,
                    height,
                    touchAction: 'none',
                    cursor: closed ? 'not-allowed' : 'crosshair',
                }}
            />
            {labelPos && (
                <div
                    className="absolute pointer-events-none px-2 py-1 rounded-lg bg-slate-900/85 text-white text-xs font-medium shadow-lg"
                    style={{
                        left: labelPos.x,
                        top: labelPos.y,
                        transform: 'translate(-50%, -50%)',
                    }}
                >
                    {labelPos.text}
                </div>
            )}
            <LengthInputSheet
                open={pending !== null}
                direction={pending?.direction ?? null}
                estimatedLengthMm={pending?.estimatedLengthMm ?? 0}
                closing={pending?.closing ?? false}
                onCancel={onSheetCancel}
                onConfirm={onSheetConfirm}
            />
        </>
    );
}

function dirArrow(d: Direction): string {
    return { N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖' }[d];
}
