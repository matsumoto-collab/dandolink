/**
 * 道路申請の図面ページ（DrawingPage.tsx）で使う Svg の部品。座標はすべて pt（Y 下向き・左上原点）。
 *
 * 決まり
 * - 印刷は黒（INK）だけ。画面のレイヤ色は使わない。
 * - 線種は用紙上の mm で決めた長さを pt に直して strokeDasharray にする（縮尺を変えても印刷の見た目は同じ）。
 * - 文字は Svg の Text（書体 NotoSerifJP）。SafeText の置き換え（㎡→m² など）は Svg の Text には効かないので、
 *   ここで sanitizePdfText を通してから出す。
 * - Svg の要素に直接 transform を付けると react-pdf 4.x では描かれないことがあるため、回転は G で包んで行う。
 */
import React from 'react';
import { G, Line, Polygon, Polyline, Text } from '@react-pdf/renderer';
import type { LineType, LineWidth } from '@/types/roadPermitDrawing';
import { LINE_WIDTH_MM, PT_PER_MM } from '@/lib/roadPermit/drawing/paper';
import { sanitizePdfText } from '../styles';

export const INK = '#000000';

export interface Pt {
    x: number;
    y: number;
}

/** 線の太さ（pt） */
export function lineWidthPt(w: LineWidth): number {
    return LINE_WIDTH_MM[w] * PT_PER_MM;
}

/** 線種（用紙上 mm）。実線は undefined */
const DASH_MM: Record<LineType, number[] | null> = {
    solid: null,
    dashed: [3, 1.5],
    dashdot: [6, 1.5, 1, 1.5],
    dotted: [0.8, 1.2],
};

export function strokeDash(t: LineType): string | undefined {
    const d = DASH_MM[t];
    return d ? d.map((v) => (v * PT_PER_MM).toFixed(2)).join(',') : undefined;
}

const f = (v: number) => v.toFixed(2);
const ptsAttr = (pts: Pt[]) => pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');

/** 線分 */
export function SegPt({ a, b, sw, dash }: { a: Pt; b: Pt; sw: number; dash?: string }) {
    return (
        <Line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={INK}
            strokeWidth={sw}
            strokeLinecap="butt"
            {...(dash ? { strokeDasharray: dash } : {})}
        />
    );
}

/** 折れ線・閉じた多角形。fill を渡すと塗る（sw=0 なら線は引かない） */
export function PolyPt({ pts, closed, sw, dash, fill }: { pts: Pt[]; closed: boolean; sw: number; dash?: string; fill?: string }) {
    if (pts.length < 2) return null;
    const stroke = sw > 0 ? { stroke: INK, strokeWidth: sw, strokeLinejoin: 'miter' as const } : {};
    const dashProp = dash ? { strokeDasharray: dash } : {};
    if (closed) {
        return <Polygon points={ptsAttr(pts)} fill={fill ?? 'none'} {...stroke} {...dashProp} />;
    }
    return <Polyline points={ptsAttr(pts)} fill="none" {...stroke} {...dashProp} />;
}

/** 閉じた三角の矢印。tip が先端、from が線の反対側（向きを決めるだけ） */
export function ArrowHead({ tip, from, lengthPt }: { tip: Pt; from: Pt; lengthPt: number }) {
    const len = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (len < 1e-6) return null;
    const ux = (tip.x - from.x) / len;
    const uy = (tip.y - from.y) / len;
    // 矢印の開き（片側）。長さ 2.5mm に対して半幅 0.45mm ≒ 10 度
    const half = lengthPt * 0.18;
    const base = { x: tip.x - ux * lengthPt, y: tip.y - uy * lengthPt };
    const l = { x: base.x - uy * half, y: base.y + ux * half };
    const r = { x: base.x + uy * half, y: base.y - ux * half };
    return <Polygon points={ptsAttr([tip, l, r])} fill={INK} stroke={INK} strokeWidth={0.2} />;
}

/**
 * 回転した向きを、文字が逆さにならない向き（-90 以上〜90 未満）にそろえる（pt の角度・時計回りが正）。
 * 縦の寸法は -90（下から上へ読む・寸法線の左に置く）になる＝製図の決まりと同じ。
 */
export function readableAngle(deg: number): number {
    let a = deg;
    while (a >= 90) a -= 180;
    while (a < -90) a += 180;
    return a;
}

/** 文字の幅の見積もり（全角 = 1em・半角 = 0.6em。roadPermitPdfShared.estimateTextWidth と同じ換算） */
export function estimateDrawTextWidth(text: string, sizePt: number): number {
    let units = 0;
    for (const ch of sanitizePdfText(text)) units += /[\x00-\xff｡-ﾟ²³]/.test(ch) ? 0.6 : 1;
    return units * sizePt;
}

/**
 * Svg の Text の書体と大きさ。react-pdf 4.x は実行時に props の fontFamily・fontSize を読むが、型（SVGTextProps）に
 * 書かれていないので object として渡す。
 */
function svgFont(sizePt: number): object {
    return { fontFamily: 'NotoSerifJP', fontSize: sizePt };
}

/**
 * 文字。at はベースラインの基準点（anchor に応じて 左／中央／右）。rotateDeg は pt での回転（時計回りが正）。
 * 改行は 1 行ずつ下にずらして出す。
 */
export function DrawText({
    at,
    text,
    sizePt,
    rotateDeg = 0,
    anchor = 'start',
}: {
    at: Pt;
    text: string;
    sizePt: number;
    rotateDeg?: number;
    anchor?: 'start' | 'middle' | 'end';
}) {
    const lines = sanitizePdfText(text).split('\n');
    if (lines.every((l) => l.trim() === '')) return null;
    return (
        <G transform={`translate(${f(at.x)}, ${f(at.y)}) rotate(${f(rotateDeg)})`}>
            {lines.map((line, i) =>
                line === '' ? null : (
                    <Text key={i} x={0} y={i * sizePt * 1.2} {...svgFont(sizePt)} fill={INK} textAnchor={anchor}>
                        {line}
                    </Text>
                ),
            )}
        </G>
    );
}
