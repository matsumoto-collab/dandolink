/**
 * 用紙と縮尺・座標変換（純粋関数。画面と PDF の両方から使う）。
 *
 * 3 つの座標系
 * - 実寸（mm・Y 上向き）… 図形が持つ値
 * - 用紙（mm・Y 上向き・左下が原点）… 用紙上の位置 = (p − origin) / scale
 * - pt（PDF・Y 下向き・左上が原点）… 1mm = 72/25.4 pt
 * 画面（konva・Y 下向き）への変換は作図画面側で ズーム・パン と合わせて行う（用紙 mm → px）。
 */
import type { DrawingPoint, PaperOrientation, PaperSize, RoadPermitDrawing } from '@/types/roadPermitDrawing';

/** 用紙の大きさ（mm・横向き） */
export const PAPER_SIZES_MM: Record<PaperSize, { long: number; short: number }> = {
    A4: { long: 297, short: 210 },
    A3: { long: 420, short: 297 },
};

/** 用紙の枠（印刷する範囲）の内側の余白（mm） */
export const PAPER_MARGIN_MM = 10;

export const MM_PER_PT = 25.4 / 72;
export const PT_PER_MM = 72 / 25.4;

/** 線の太さ（mm） */
export const LINE_WIDTH_MM = { thin: 0.13, normal: 0.25, thick: 0.5 } as const;

export function paperSizeMm(size: PaperSize, orientation: PaperOrientation): { w: number; h: number } {
    const s = PAPER_SIZES_MM[size];
    return orientation === 'landscape' ? { w: s.long, h: s.short } : { w: s.short, h: s.long };
}

export function drawingPaperMm(d: Pick<RoadPermitDrawing, 'paper'>): { w: number; h: number } {
    return paperSizeMm(d.paper.size, d.paper.orientation);
}

/** 実寸 → 用紙（mm・左下原点・Y 上向き） */
export function toPaper(p: DrawingPoint, d: Pick<RoadPermitDrawing, 'origin' | 'scale'>): DrawingPoint {
    return { x: (p.x - d.origin.x) / d.scale, y: (p.y - d.origin.y) / d.scale };
}

/** 用紙（mm）→ 実寸 */
export function fromPaper(p: DrawingPoint, d: Pick<RoadPermitDrawing, 'origin' | 'scale'>): DrawingPoint {
    return { x: p.x * d.scale + d.origin.x, y: p.y * d.scale + d.origin.y };
}

/** 用紙（mm・Y 上向き）→ PDF の pt（Y 下向き・左上原点） */
export function paperToPt(p: DrawingPoint, paperH: number): { x: number; y: number } {
    return { x: p.x * PT_PER_MM, y: (paperH - p.y) * PT_PER_MM };
}

/** 実寸 → PDF の pt */
export function toPt(p: DrawingPoint, d: Pick<RoadPermitDrawing, 'origin' | 'scale' | 'paper'>): { x: number; y: number } {
    return paperToPt(toPaper(p, d), drawingPaperMm(d).h);
}

/** 用紙上の長さ（mm）→ 実寸（mm）。文字の高さ・ハッチの間隔を実寸に直すのに使う */
export function paperMmToReal(mm: number, d: Pick<RoadPermitDrawing, 'scale'>): number {
    return mm * d.scale;
}

/** 実寸の長さ → 用紙上の長さ（mm） */
export function realToPaperMm(mm: number, d: Pick<RoadPermitDrawing, 'scale'>): number {
    return mm / d.scale;
}

/** 用紙の中に図形の範囲（実寸）を収める origin を返す（左下余白 margin・縦横とも中央寄せ） */
export function originToFit(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    d: Pick<RoadPermitDrawing, 'scale' | 'paper'>,
): DrawingPoint {
    const { w, h } = drawingPaperMm(d);
    const innerW = (w - PAPER_MARGIN_MM * 2) * d.scale;
    const innerH = (h - PAPER_MARGIN_MM * 2) * d.scale;
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;
    return {
        x: bbox.minX - PAPER_MARGIN_MM * d.scale - Math.max(0, (innerW - bw) / 2),
        y: bbox.minY - PAPER_MARGIN_MM * d.scale - Math.max(0, (innerH - bh) / 2),
    };
}

/** 縮尺の表記（S=1/100） */
export function scaleLabel(scale: number): string {
    return `S=1/${scale}`;
}

/** 用紙の表記（A3 横） */
export function paperLabel(size: PaperSize, orientation: PaperOrientation): string {
    return `${size} ${orientation === 'landscape' ? '横' : '縦'}`;
}
