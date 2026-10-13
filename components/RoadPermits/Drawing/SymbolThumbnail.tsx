'use client';

/**
 * 記号の下絵（小さな SVG）。記号の登録画面の一覧・取り込みの候補・作図画面のパレット・凡例で使う。
 * 形は lib/roadPermit/symbols/geometry.ts の symbolPolylines で点列にして、1 つの path で描く（図形が多くても軽い）。
 * 線が多すぎる形は、長い線から maxPrimitives 本だけ描く（下絵なので細かい線は要らない）。
 */
import React, { useMemo } from 'react';
import type { RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';
import { symbolBBox, symbolPolylines } from '@/lib/roadPermit/symbols/geometry';

export interface SymbolThumbnailProps {
    geometry: RoadPermitSymbolGeometry;
    /** 1 辺の大きさ（px）。既定 48 */
    size?: number;
    stroke?: string;
    className?: string;
    title?: string;
    /** 描く折れ線の上限（長いものから） */
    maxPrimitives?: number;
}

function polyLength(poly: { x: number; y: number }[]): number {
    let len = 0;
    for (let i = 0; i + 1 < poly.length; i++) len += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    return len;
}

/** 形 → SVG の path の d（viewBox は 0〜size・Y 下向き・余白つき） */
export function symbolThumbnailPath(geometry: RoadPermitSymbolGeometry, size: number, maxPrimitives: number): string {
    const bb = symbolBBox(geometry);
    const w = Math.max(bb.maxX - bb.minX, 1e-6);
    const h = Math.max(bb.maxY - bb.minY, 1e-6);
    const pad = size * 0.08;
    const k = (size - pad * 2) / Math.max(w, h);
    const ox = pad + ((size - pad * 2) - w * k) / 2;
    const oy = pad + ((size - pad * 2) - h * k) / 2;
    let polys = symbolPolylines(geometry);
    if (polys.length > maxPrimitives) {
        polys = polys
            .map((p) => ({ p, len: polyLength(p) }))
            .sort((a, b) => b.len - a.len)
            .slice(0, maxPrimitives)
            .map((x) => x.p);
    }
    const f = (v: number) => (Math.round(v * 100) / 100).toString();
    const parts: string[] = [];
    for (const poly of polys) {
        for (let i = 0; i < poly.length; i++) {
            const x = ox + (poly[i].x - bb.minX) * k;
            const y = oy + (bb.maxY - poly[i].y) * k;
            parts.push(`${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`);
        }
    }
    return parts.join('');
}

export default function SymbolThumbnail({ geometry, size = 48, stroke = '#334155', className, title, maxPrimitives = 1500 }: SymbolThumbnailProps) {
    const d = useMemo(() => symbolThumbnailPath(geometry, size, maxPrimitives), [geometry, size, maxPrimitives]);
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={className}
            role="img"
            aria-label={title ?? '記号の下絵'}
        >
            {title && <title>{title}</title>}
            <path d={d} fill="none" stroke={stroke} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
