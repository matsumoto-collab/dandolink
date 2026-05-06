'use client';

import React, { useRef } from 'react';
import type { CanvasFit } from '@/stores/siteSurveySlices/types';

interface TextInputControllerProps {
    width: number;
    height: number;
    fit: CanvasFit;
    onRequestNewText: (xMm: number, yMm: number) => void;
    sheetOpen?: boolean;
}

const MOVE_THRESHOLD_PX = 8;

export default function TextInputController({
    width,
    height,
    fit,
    onRequestNewText,
    sheetOpen = false,
}: TextInputControllerProps) {
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const movedRef = useRef<boolean>(false);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (sheetOpen) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        pointerDownPosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        movedRef.current = false;
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerDownPosRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const dx = local.x - pointerDownPosRef.current.x;
        const dy = local.y - pointerDownPosRef.current.y;
        if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) movedRef.current = true;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerDownPosRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        if (!movedRef.current) {
            const xMm = (local.x - fit.offsetX) / fit.scale;
            const yMm = (local.y - fit.offsetY) / fit.scale;
            onRequestNewText(xMm, yMm);
        }

        pointerDownPosRef.current = null;
        movedRef.current = false;
    };

    const handlePointerCancel = (_e: React.PointerEvent<HTMLDivElement>) => {
        pointerDownPosRef.current = null;
        movedRef.current = false;
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
