/**
 * 道路申請の図面に置く「記号」（docs/指示書_道路申請_Phase2b_記号.md §3）。
 *
 * 決まり
 * - 形（geometry）は kei の JWW から取り込んだもの。基準点（記号の中心）を原点にした 実寸 mm・Y 上向き
 * - 形は取り込んだあと直さない（図面は SymbolEntity.symbolId で記号を指すので、形が変わると過去の図面が変わる）。
 *   消すかわりに isActive=false（パレットから消えるだけで、過去の図面には出続ける）
 * - DB から読んだら lib/roadPermit/symbols/normalize.ts の normalize を通す
 * - 取り込んだ形は DB にだけ置く（リポジトリに入れない。CAD素材.com の利用条件・設計書 §6.4）
 */
import type { DrawingLayerId, DrawingPoint } from '@/types/roadPermitDrawing';

/** 分類（パレットのタブ・一覧の絞り込み） */
export const ROAD_PERMIT_SYMBOL_CATEGORIES = ['cone', 'barricade', 'vehicle', 'crane', 'person', 'road', 'other'] as const;
export type RoadPermitSymbolCategory = (typeof ROAD_PERMIT_SYMBOL_CATEGORIES)[number];

export const ROAD_PERMIT_SYMBOL_CATEGORY_LABELS: Record<RoadPermitSymbolCategory, string> = {
    cone: 'コーン類',
    barricade: 'バリケード',
    vehicle: '車両',
    crane: 'クレーン',
    person: '人',
    road: '路面標示',
    other: 'その他',
};

/** 記号を置くときの書込レイヤの初期値（車両・クレーン＝4 車両、それ以外＝3 保安施設。指示書 §5.1） */
export const ROAD_PERMIT_SYMBOL_DEFAULT_LAYER: Record<RoadPermitSymbolCategory, DrawingLayerId> = {
    cone: 3,
    barricade: 3,
    vehicle: 4,
    crane: 4,
    person: 3,
    road: 0,
    other: 3,
};

/** 数量の単位の候補（自由入力もできる） */
export const ROAD_PERMIT_SYMBOL_COUNT_UNITS = ['個', '本', '台', '人', '基', '枚', '式'] as const;

/**
 * 記号の形。すべて 実寸 mm・基準点（中心）が原点・Y 上向き。数値は平らな配列で持つ（JSON を小さくするため）。
 * - lines     … 線分 [x1, y1, x2, y2, ...]（4 つで 1 本）
 * - circles   … 円 [cx, cy, r, ...]（3 つで 1 つ）
 * - arcs      … 円弧 [cx, cy, r, startDeg, endDeg, ...]（5 つで 1 つ。startDeg から endDeg へ反時計回り・度）
 * - polylines … 連続線（楕円弧などを折れ線にしたもの）。1 本＝[x, y, x, y, ...]
 * 文字は持たない（名前は凡例と数量の文で出す）
 */
export interface RoadPermitSymbolGeometry {
    lines: number[];
    circles: number[];
    arcs: number[];
    polylines: number[][];
}

/** 記号 1 つ（API の応答・画面・PDF で使う形） */
export interface RoadPermitSymbolDto {
    id: string;
    /** 画面と凡例に出す名前（例「4t ユニック車」「カラーコーン」） */
    name: string;
    category: RoadPermitSymbolCategory;
    /** 数量の文での名前（例「カラーコーン」）。空なら数えない */
    countLabel: string;
    /** 個・本・台・人 など */
    countUnit: string;
    /** 数量の文に添える文字（例「1.5m」）。空なら付けない */
    countNote: string;
    geometry: RoadPermitSymbolGeometry;
    /** 形の大きさ（実寸 mm）。lengthMm＝横（X 方向）・widthMm＝縦（Y 方向）。画面は「長さ×幅」の順で出す */
    lengthMm: number;
    widthMm: number;
    /** コーンバーとして使うときのコーンの中心の間隔（mm・整数）。null＝コーンバーではない */
    barPitchMm: number | null;
    /** 取り込み元のファイル名・ブロック名 */
    sourceFile: string;
    sourceBlock: string;
    /** 出どころ（例「CAD素材.com」）。一覧にだけ出す */
    sourceNote: string;
    sortOrder: number;
    /** パレットに出すか（false でも過去の図面には出る） */
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/** GET /api/road-permits/symbols の応答（使わないものも含めて全部。形も入る） */
export interface RoadPermitSymbolsResponse {
    symbols: RoadPermitSymbolDto[];
}

/** POST /api/road-permits/symbols（1 件登録） */
export interface RoadPermitSymbolCreatePayload {
    name: string;
    category: RoadPermitSymbolCategory;
    countLabel: string;
    countUnit: string;
    countNote: string;
    geometry: RoadPermitSymbolGeometry;
    lengthMm: number;
    widthMm: number;
    barPitchMm: number | null;
    sourceFile: string;
    sourceBlock: string;
    sourceNote: string;
    isActive?: boolean;
}

/** PUT /api/road-permits/symbols/[id]（名前・分類・数量の数え方・コーンバーの間隔・出どころ・並び順・使う／使わない。形は直せない） */
export type RoadPermitSymbolUpdatePayload = Partial<
    Pick<RoadPermitSymbolDto, 'name' | 'category' | 'countLabel' | 'countUnit' | 'countNote' | 'barPitchMm' | 'sourceNote' | 'sortOrder' | 'isActive'>
>;

/** POST /api/road-permits/symbols/parse で読んだ JWW の 1 ブロック */
export interface ParsedJwwBlock {
    /** 画面の選択用（ブロック番号） */
    key: string;
    /** 掃除した名前（「（CAD素材.com）」「@@SfigorgFlag@@4」を外したもの） */
    name: string;
    rawName: string;
    /** 中心を原点にそろえ、必要なら簡略化した形（そのまま登録に使える） */
    geometry: RoadPermitSymbolGeometry;
    lengthMm: number;
    widthMm: number;
    /** 線・円・円弧・連続線の区間の合計 */
    primitiveCount: number;
    /** 実寸にするために掛けた倍率（1 なら掛けていない） */
    scaleApplied: number;
    /** 簡略化したとき { before, after }。していなければ null */
    simplified: { before: number; after: number } | null;
    /** 図の上でそのブロックの近くに書かれた文字（名前の候補。無ければ空） */
    nearbyTexts: string[];
}

export interface ParseJwwResponse {
    fileName: string;
    blocks: ParsedJwwBlock[];
    /** 画面に出す注意（例「倍率 20 を掛けました」「補助線を 3 本除きました」） */
    warnings: string[];
}

/** 記号の置き方（SymbolEntity の at・rotationDeg・mirrored と同じ）。反転 → 回転 → 移動 の順に効く */
export interface SymbolPlacement {
    at: DrawingPoint;
    /** 度・反時計回り */
    rotationDeg: number;
    /** 記号の縦軸（Y 軸）で左右を反転（回転の前に効く） */
    mirrored: boolean;
}

/** symbolId → 記号。画面（作図・PDF）が図面を開くときに作る */
export type RoadPermitSymbolMap = ReadonlyMap<string, RoadPermitSymbolDto>;
