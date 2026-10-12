/**
 * 道路申請の図面（平面図＝保安施設配置図）のデータの形。RoadPermit.drawing（JSON）にそのまま入る。
 *
 * 決まり（docs/指示書_道路申請_Phase2.md §1・設計書 §6）
 * - 図形は 実寸 mm・Y 上向き（JWW・DXF と同じ）。画面と PDF は縮尺で表示するだけ
 * - 用紙上の位置（mm）= (p − origin) / scale。origin は用紙の左下隅に来る図面座標
 * - 文字と寸法の文字の大きさは 用紙上の高さ（mm）で持つ（縮尺を変えても印刷の文字の大きさは同じ）
 * - レイヤは 7 枚固定（0〜6）。表示／ロック／印刷の切り替えだけ（名前は変えない）
 * - DB から読んだら lib/roadPermit/drawing/defaults.ts の normalizeRoadPermitDrawing を必ず通す
 */

export const DRAWING_VERSION = 1 as const;

export type PaperSize = 'A4' | 'A3';
export type PaperOrientation = 'landscape' | 'portrait';

/** 縮尺の分母（S=1/100 なら 100） */
export const DRAWING_SCALES = [50, 100, 200, 250, 300] as const;
export type DrawingScale = (typeof DRAWING_SCALES)[number];

export type LineType = 'solid' | 'dashed' | 'dashdot' | 'dotted';
/** 線の太さ（印刷時）: 細 0.13mm／普通 0.25mm／太 0.5mm */
export type LineWidth = 'thin' | 'normal' | 'thick';

/** 実寸 mm・Y 上向き */
export interface DrawingPoint {
    x: number;
    y: number;
}

export interface DrawingStyle {
    lineType: LineType;
    width: LineWidth;
    /** 色（#rrggbb）。印刷は黒が基本。画面の見分け用にレイヤ色を使うことがある */
    color: string;
}

export type DrawingLayerId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DrawingLayer {
    id: DrawingLayerId;
    /** 名前（固定: 0 道路・境界／1 建物・敷地／2 足場・養生／3 保安施設／4 車両／5 寸法・文字／6 下敷き） */
    name: string;
    visible: boolean;
    locked: boolean;
    printable: boolean;
}

interface EntityBase {
    id: string;
    layer: DrawingLayerId;
    style: DrawingStyle;
}

/** 線（2 点） */
export interface LineEntity extends EntityBase {
    kind: 'line';
    a: DrawingPoint;
    b: DrawingPoint;
}

/** 連続線・矩形（closed=true で閉じる） */
export interface PolylineEntity extends EntityBase {
    kind: 'polyline';
    points: DrawingPoint[];
    closed: boolean;
}

export interface CircleEntity extends EntityBase {
    kind: 'circle';
    center: DrawingPoint;
    r: number;
}

/** 円弧（startDeg から endDeg へ反時計回り。角度は度・X 軸正方向が 0） */
export interface ArcEntity extends EntityBase {
    kind: 'arc';
    center: DrawingPoint;
    r: number;
    startDeg: number;
    endDeg: number;
}

export type TextAlign = 'left' | 'center' | 'right';

/** 文字。at は基準点（align に応じて 左下／中央下／右下） */
export interface TextEntity extends EntityBase {
    kind: 'text';
    at: DrawingPoint;
    text: string;
    /** 用紙上の文字の高さ（mm）。既定 3 */
    heightPaperMm: number;
    /** 回転（度・反時計回り） */
    rotationDeg: number;
    align: TextAlign;
}

export type DimensionMode = 'aligned' | 'horizontal' | 'vertical';

/**
 * 寸法。a・b を測り、寸法線は測る方向から offsetMm（実寸 mm・符号で側）だけ離して引く。
 * 寸法値は実寸 mm を自動で出す（textOverride があればその文字）。
 */
export interface DimensionEntity extends EntityBase {
    kind: 'dimension';
    a: DrawingPoint;
    b: DrawingPoint;
    offsetMm: number;
    mode: DimensionMode;
    textOverride: string | null;
    /** 用紙上の文字の高さ（mm）。既定 2.5 */
    heightPaperMm: number;
}

/** 引出線（折れ線の最後の点の先に文字） */
export interface LeaderEntity extends EntityBase {
    kind: 'leader';
    points: DrawingPoint[];
    text: string;
    heightPaperMm: number;
}

export type HatchPattern = 'diagonal' | 'cross' | 'solid';

/** 塗り（ハッチ）。閉じた多角形の中を斜線で塗る */
export interface HatchEntity extends EntityBase {
    kind: 'hatch';
    points: DrawingPoint[];
    pattern: HatchPattern;
    /** 斜線の間隔（用紙上の mm）。既定 2 */
    spacingPaperMm: number;
}

/** 記号（Phase 2b。symbolId は記号カタログの id） */
export interface SymbolEntity extends EntityBase {
    kind: 'symbol';
    symbolId: string;
    at: DrawingPoint;
    rotationDeg: number;
    mirrored: boolean;
}

export type DrawingEntity =
    | LineEntity
    | PolylineEntity
    | CircleEntity
    | ArcEntity
    | TextEntity
    | DimensionEntity
    | LeaderEntity
    | HatchEntity
    | SymbolEntity;

export type DrawingEntityKind = DrawingEntity['kind'];

/** 表題欄（右下）。空の欄は values（申請の入力値）から自動で入れる */
export interface DrawingTitleBlock {
    drawingName: string;
    location: string;
    routeName: string;
    period: string;
    author: string;
}

export interface RoadPermitDrawing {
    version: typeof DRAWING_VERSION;
    paper: { size: PaperSize; orientation: PaperOrientation };
    scale: DrawingScale;
    /** 用紙の左下隅に来る図面座標（実寸 mm） */
    origin: DrawingPoint;
    layers: DrawingLayer[];
    /** 書込レイヤ */
    currentLayer: DrawingLayerId;
    entities: DrawingEntity[];
    titleBlock: DrawingTitleBlock;
    showTitleBlock: boolean;
    showNorthArrow: boolean;
    showScaleBar: boolean;
}
