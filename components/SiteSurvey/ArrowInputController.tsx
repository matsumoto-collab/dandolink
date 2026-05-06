'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import {
    directionVector,
    pxToMm,
    mmToPx,
    canCloseAt,
    snapToGrid,
} from '@/utils/drawingMath';
import type { CanvasFit, Direction, Point } from '@/stores/siteSurveySlices/types';

export interface LengthSheetRequest {
    direction: Direction;
    estimatedLengthMm: number;
    closing: boolean;
    fromPointIndex: number;
}

interface ArrowInputControllerProps {
    width: number;
    height: number;
    fit: CanvasFit;
    onGhostChange: (ghost: {
        fromPx: { x: number; y: number };
        toPx: { x: number; y: number };
        label?: string;
    } | null) => void;
    onPan?: (deltaMm: { x: number; y: number }) => void;
    onRequestLengthSheet: (req: LengthSheetRequest) => void;
    sheetOpen?: boolean;
}

const PAN_THRESHOLD_PX = 8;

interface PointHit {
    sectionId: string;
    pointIndex: number;
}

interface DragState {
    startPx: { x: number; y: number };
    lastPx: { x: number; y: number };
    pointerId: number;
    isPanning: boolean;
    targetType: 'point' | 'empty';
    targetHit: PointHit | null;
}

const POINT_HIT_RADIUS_PX = 40;
const CLOSE_THRESHOLD_MM = 800;
const DEFAULT_LENGTH_MM = 1820;
const BUTTON_SIZE = 40;

const ARROW_BUTTONS: Array<{
    direction: Direction;
    icon: React.ComponentType<{ className?: string }>;
    offset: { x: number; y: number };
    label: string;
}> = [
    { direction: 'N', icon: ArrowUp, offset: { x: 0, y: -56 }, label: '上' },
    { direction: 'E', icon: ArrowRight, offset: { x: 56, y: 0 }, label: '右' },
    { direction: 'S', icon: ArrowDown, offset: { x: 0, y: 56 }, label: '下' },
    { direction: 'W', icon: ArrowLeft, offset: { x: -56, y: 0 }, label: '左' },
];

export default function ArrowInputController({
    width,
    height,
    fit,
    onGhostChange,
    onPan,
    onRequestLengthSheet,
    sheetOpen = false,
}: ArrowInputControllerProps) {
    const data = useDrawingStore((s) => s.data);
    const currentSectionId = useDrawingStore((s) => s.currentSectionId);
    const currentPointIndex = useDrawingStore((s) => s.currentPointIndex);
    const startNewSection = useDrawingStore((s) => s.startNewSection);
    const setCurrentSection = useDrawingStore((s) => s.setCurrentSection);

    const section =
        data.sections.find((s) => s.id === currentSectionId) ?? data.sections[0];
    const points = section?.polygon.points ?? [];
    const closed = section?.polygon.closed ?? false;

    const overlayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const [arrowsVisible, setArrowsVisible] = useState(false);

    // 現在 active な点（currentPointIndex 未設定時は末尾）
    const activeIndex =
        currentPointIndex !== null && currentPointIndex >= 0 && currentPointIndex < points.length
            ? currentPointIndex
            : points.length > 0
                ? points.length - 1
                : null;

    // フェードイン制御: 矢印を表示するタイミングで opacity 0→1
    const [showButtons, setShowButtons] = useState(false);
    useEffect(() => {
        if (!arrowsVisible || activeIndex === null || closed || sheetOpen) {
            setShowButtons(false);
            return;
        }
        setShowButtons(false);
        const t = setTimeout(() => setShowButtons(true), 100);
        return () => clearTimeout(t);
    }, [arrowsVisible, activeIndex, closed, sheetOpen]);

    // 多角形が閉じたら強制非表示
    useEffect(() => {
        if (closed) setArrowsVisible(false);
    }, [closed]);

    // Esc キーで非表示
    useEffect(() => {
        if (!arrowsVisible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setArrowsVisible(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [arrowsVisible]);

    const findPointAt = useCallback(
        (px: { x: number; y: number }): PointHit | null => {
            // active section を優先（同じ座標で重なるケース＝枝分かれ後）
            const ordered = [
                ...data.sections.filter((s) => s.id === currentSectionId),
                ...data.sections.filter((s) => s.id !== currentSectionId),
            ];
            for (const sec of ordered) {
                for (let i = 0; i < sec.polygon.points.length; i++) {
                    const pp = mmToPx(sec.polygon.points[i], fit);
                    if (Math.hypot(pp.x - px.x, pp.y - px.y) <= POINT_HIT_RADIUS_PX) {
                        return { sectionId: sec.id, pointIndex: i };
                    }
                }
            }
            return null;
        },
        [data.sections, currentSectionId, fit],
    );

    const getLocalPx = (e: React.PointerEvent) => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (sheetOpen) return;
        const px = getLocalPx(e);
        const hit = findPointAt(px);
        dragRef.current = {
            startPx: px,
            lastPx: px,
            pointerId: e.pointerId,
            isPanning: false,
            targetType: hit !== null ? 'point' : 'empty',
            targetHit: hit,
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

        if (drag.isPanning && onPan) {
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

        // ケース: 既存の点をタップ
        if (drag.targetType === 'point' && drag.targetHit) {
            const hit = drag.targetHit;
            const targetSection = data.sections.find((s) => s.id === hit.sectionId);
            if (!targetSection) return;
            if (targetSection.polygon.closed) {
                // 枝分かれ: 同座標で新セクション開始
                const p = targetSection.polygon.points[hit.pointIndex];
                startNewSection(p.x, p.y);
            } else {
                setCurrentSection(hit.sectionId, hit.pointIndex);
            }
            setArrowsVisible(true);
            return;
        }

        // ケース: 何もない場所をタップ
        const currentSec = data.sections.find((s) => s.id === currentSectionId);
        if (!currentSec || currentSec.polygon.closed) {
            const mm = snapToGrid(pxToMm(px, fit));
            startNewSection(mm.x, mm.y);
            setArrowsVisible(true);
            return;
        }
        // 開いているセクション編集中の空白タップ → 矢印を消す
        setArrowsVisible(false);
    };

    const handlePointerCancel = (e: React.PointerEvent) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    };

    // 各方向ごとに「閉じるか？」を事前計算（amber ring 用）
    const closingByDir = useMemo(() => {
        const result: Partial<Record<Direction, boolean>> = {};
        if (!section || activeIndex === null) return result;
        const start = points[activeIndex];
        if (!start) return result;
        for (const { direction: dir } of ARROW_BUTTONS) {
            const v = directionVector(dir);
            const candidate: Point = {
                x: start.x + v.dx * DEFAULT_LENGTH_MM,
                y: start.y + v.dy * DEFAULT_LENGTH_MM,
            };
            result[dir] = canCloseAt(section, candidate, CLOSE_THRESHOLD_MM);
        }
        return result;
    }, [section, activeIndex, points]);

    const handleArrowTap = (dir: Direction) => {
        if (activeIndex === null || !section) return;
        const start = points[activeIndex];
        if (!start) return;
        const v = directionVector(dir);
        const candidate: Point = {
            x: start.x + v.dx * DEFAULT_LENGTH_MM,
            y: start.y + v.dy * DEFAULT_LENGTH_MM,
        };
        const closing = canCloseAt(section, candidate, CLOSE_THRESHOLD_MM);

        // ゴーストプレビュー
        const fromPx = mmToPx(start, fit);
        const toPx = mmToPx(candidate, fit);
        onGhostChange({ fromPx, toPx });

        onRequestLengthSheet({
            direction: dir,
            estimatedLengthMm: DEFAULT_LENGTH_MM,
            closing,
            fromPointIndex: activeIndex,
        });
    };

    // active 点の screen 座標
    const activePx = activeIndex !== null ? mmToPx(points[activeIndex], fit) : null;

    return (
        <>
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
                    cursor: 'grab',
                }}
            />

            {/* 8方向矢印ボタン */}
            {arrowsVisible && activePx && !closed && !sheetOpen && (
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ zIndex: 30 }}
                >
                    {ARROW_BUTTONS.map(({ direction: dir, icon: Icon, offset: off }) => {
                        // 画面端クランプ
                        const cx = Math.max(
                            BUTTON_SIZE / 2 + 4,
                            Math.min(width - BUTTON_SIZE / 2 - 4, activePx.x + off.x),
                        );
                        const cy = Math.max(
                            BUTTON_SIZE / 2 + 4,
                            Math.min(height - BUTTON_SIZE / 2 - 4, activePx.y + off.y),
                        );
                        const isClosing = closingByDir[dir];
                        return (
                            <button
                                key={dir}
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleArrowTap(dir);
                                }}
                                aria-label={`${dir} 方向に壁を追加`}
                                className={`absolute flex items-center justify-center h-10 w-10 rounded-xl border shadow-sm transition-all duration-150 active:scale-95 pointer-events-auto ${
                                    isClosing
                                        ? 'bg-gradient-to-br from-teal-500 to-emerald-500 text-white border-teal-500 ring-2 ring-amber-400'
                                        : 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50'
                                }`}
                                style={{
                                    left: cx - BUTTON_SIZE / 2,
                                    top: cy - BUTTON_SIZE / 2,
                                    opacity: showButtons ? 1 : 0,
                                    transition:
                                        'opacity 150ms ease-out, background-color 100ms, transform 100ms',
                                }}
                            >
                                <Icon className="w-5 h-5" />
                            </button>
                        );
                    })}
                </div>
            )}

        </>
    );
}
