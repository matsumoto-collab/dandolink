// 現場調査 / 作図機能の型定義
// drawingData JSON スキーマは設計書 §5.2 に準拠

export interface Point {
    x: number; // mm
    y: number; // mm
}

export interface Polygon {
    points: Point[];
    closed: boolean;
}

export interface Opening {
    wallIndex: number;
    position: number; // 0-1 の比率
    width: number;    // mm
}

export interface Section {
    id: string;
    name: string;
    height: number; // mm
    polygon: Polygon;
    openings: Opening[];
}

export type MarkerColor = 'red' | 'blue' | 'green' | 'yellow';

export interface Marker {
    id: string;
    points: Point[];
    color: MarkerColor;
}

export interface TextAnnotation {
    id: string;
    x: number;
    y: number;
    text: string;
}

export interface DrawingData {
    version: '1.0';
    sections: Section[];
    markers: Marker[];
    texts: TextAnnotation[];
}

export interface DrawingStats {
    perimeter: number;    // m
    floorArea: number;    // m²
    scaffoldArea: number; // m²
}

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface CanvasFit {
    scale: number;
    offsetX: number;
    offsetY: number;
}
