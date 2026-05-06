'use client';

import React, { useRef, useState } from 'react';
import type { CanvasFit, TextAnnotation } from '@/stores/siteSurveySlices/types';

interface TextLayerProps {
    fit: CanvasFit;
    texts: TextAnnotation[];
    isInteractive: boolean;
    selectedTextId: string | null;
    onTapText: (id: string) => void;
    onMoveText: (id: string, xMm: number, yMm: number) => void;
}

interface TextItemProps {
    text: TextAnnotation;
    fit: CanvasFit;
    isInteractive: boolean;
    isSelected: boolean;
    onTap: (id: string) => void;
    onMove: (id: string, xMm: number, yMm: number) => void;
}

function TextItem({ text, fit, isInteractive, isSelected, onTap, onMove }: TextItemProps) {
    const [dragOffsetPx, setDragOffsetPx] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const dragStartRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const hasMovedRef = useRef<boolean>(false);

    const baseX = text.x * fit.scale + fit.offsetX;
    const baseY = text.y * fit.scale + fit.offsetY;
    const renderX = baseX + dragOffsetPx.x;
    const renderY = baseY + dragOffsetPx.y;

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isInteractive) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStartRef.current = { clientX: e.clientX, clientY: e.clientY };
        hasMovedRef.current = false;
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStartRef.current) return;
        const dx = e.clientX - dragStartRef.current.clientX;
        const dy = e.clientY - dragStartRef.current.clientY;
        if (Math.hypot(dx, dy) > 6) hasMovedRef.current = true;
        setDragOffsetPx({ x: dx, y: dy });
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStartRef.current) return;
        e.stopPropagation();
        if (hasMovedRef.current) {
            const newPxX = baseX + dragOffsetPx.x;
            const newPxY = baseY + dragOffsetPx.y;
            const newMmX = (newPxX - fit.offsetX) / fit.scale;
            const newMmY = (newPxY - fit.offsetY) / fit.scale;
            onMove(text.id, newMmX, newMmY);
        } else {
            onTap(text.id);
        }
        dragStartRef.current = null;
        setDragOffsetPx({ x: 0, y: 0 });
        hasMovedRef.current = false;
    };

    const handlePointerCancel = (_e: React.PointerEvent<HTMLDivElement>) => {
        dragStartRef.current = null;
        setDragOffsetPx({ x: 0, y: 0 });
        hasMovedRef.current = false;
    };

    return (
        <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={{
                position: 'absolute',
                left: renderX,
                top: renderY,
                transform: 'translate(-50%, -50%)',
                pointerEvents: isInteractive ? 'auto' : 'none',
                cursor: isInteractive ? (dragStartRef.current ? 'grabbing' : 'grab') : 'default',
                userSelect: 'none',
                whiteSpace: 'pre-wrap',
                background: 'rgba(254, 252, 232, 0.95)',
                border: isSelected
                    ? '2px solid #f59e0b'
                    : '1px solid rgba(0,0,0,0.15)',
                borderRadius: 6,
                padding: '4px 10px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                fontSize: 14,
                lineHeight: 1.4,
                color: '#1f2937',
                maxWidth: 220,
                wordBreak: 'break-word',
                touchAction: 'none',
            }}
        >
            {text.text}
        </div>
    );
}

export default function TextLayer({
    fit,
    texts,
    isInteractive,
    selectedTextId,
    onTapText,
    onMoveText,
}: TextLayerProps) {
    return (
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
            {texts.map((t) => (
                <TextItem
                    key={t.id}
                    text={t}
                    fit={fit}
                    isInteractive={isInteractive}
                    isSelected={selectedTextId === t.id}
                    onTap={onTapText}
                    onMove={onMoveText}
                />
            ))}
        </div>
    );
}
