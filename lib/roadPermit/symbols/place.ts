/**
 * 記号の並べ方（純粋関数・実寸 mm・Y 上向き）。作図画面の「記号（線に沿って等間隔）」と「コーン列」で使う。
 * docs/指示書_道路申請_Phase2b_記号.md §5.1
 *
 * - arrayAlong   … 2 点の線に沿って、決めた間隔で位置を出す（始点を含む・終点を越えない）
 * - coneRowLayout … クリックした点の折れ線に、コーンとコーンバーを置く位置を出す
 *   区間ごとに 長さ L・バーの間隔 P から バーの本数 n＝L÷P の切り上げ（最低 1）、コーンの間隔＝L÷n（P 以下）。
 *   コーンは各点と区間の中（曲がり角は 1 個にまとめる）。バーは隣り合うコーンの真ん中・向きは区間の角度。
 *   バーの形は伸び縮みさせない（間隔が P より短いときは、輪がコーンの中心から少しずれるだけ）
 */
import type { DrawingPoint } from '@/types/roadPermitDrawing';
import { angleDeg, distance } from '@/lib/roadPermit/drawing/geometry';

const EPS = 1e-6;

/** 1 回で並べる数の上限（間隔を小さく入れすぎたときに画面が固まらないように） */
export const SYMBOL_ARRAY_MAX = 1000;

/** a から b へ spacingMm おきの位置（a を含む・b を越えない）。spacing ≤ 0 か a==b なら [a] */
export function arrayAlong(a: DrawingPoint, b: DrawingPoint, spacingMm: number): DrawingPoint[] {
    const len = distance(a, b);
    if (!(spacingMm > 0) || !Number.isFinite(spacingMm) || len < EPS) return [{ ...a }];
    // 割り切れるとき（10,000 を 2,000 おき）に終点の 1 個を落とさないよう、わずかに余裕を見る
    const n = Math.min(SYMBOL_ARRAY_MAX - 1, Math.floor(len / spacingMm + 1e-9));
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const out: DrawingPoint[] = [];
    for (let i = 0; i <= n; i++) out.push({ x: a.x + ux * spacingMm * i, y: a.y + uy * spacingMm * i });
    return out;
}

export interface ConeRowLayout {
    cones: DrawingPoint[];
    bars: { at: DrawingPoint; rotationDeg: number }[];
}

/**
 * コーン列の配置。points＝クリックした点（順に）・pitchMm＝コーンバーのコーンの中心の間隔（barPitchMm）。
 * 長さ 0 の区間は飛ばす。点が 1 つならコーン 1 個・バー無し。点が無ければ空。
 */
export function coneRowLayout(points: readonly DrawingPoint[], pitchMm: number): ConeRowLayout {
    const cones: DrawingPoint[] = [];
    const bars: ConeRowLayout['bars'] = [];
    // 同じ位置が続く点（長さ 0 の区間）を除く
    const pts: DrawingPoint[] = [];
    for (const p of points) {
        if (pts.length === 0 || distance(pts[pts.length - 1], p) >= EPS) pts.push(p);
    }
    if (pts.length === 0) return { cones, bars };
    cones.push({ ...pts[0] });
    const pitch = pitchMm > 0 && Number.isFinite(pitchMm) ? pitchMm : Infinity;
    for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const len = distance(a, b);
        const n = Math.min(SYMBOL_ARRAY_MAX, Math.max(1, Math.ceil(len / pitch - 1e-9)));
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const step = len / n;
        const rot = angleDeg(a, b);
        for (let i = 0; i < n; i++) {
            // 区間の始まりのコーンは前の区間の終わり（または最初の点）で置いてあるので、ここでは 1〜n 番目だけ
            const end = i + 1 === n ? { ...b } : { x: a.x + ux * step * (i + 1), y: a.y + uy * step * (i + 1) };
            cones.push(end);
            bars.push({ at: { x: a.x + ux * step * (i + 0.5), y: a.y + uy * step * (i + 0.5) }, rotationDeg: rot });
        }
    }
    return { cones, bars };
}
