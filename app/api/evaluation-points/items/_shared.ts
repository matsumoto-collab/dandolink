/**
 * 評価ポイントの点数表 API（app/api/evaluation-points/items 以下）の共通部品。
 * route.ts ではないので Next.js のルートにはならない（同じ階層の route から import するだけ）。
 *
 * 決まりごと（だれが何をできるか・どの点数を使うか）は lib/evaluationPoints.ts に書いてある。
 * ここには、入力の読み方と、応答の形をそろえる関数だけを置く（docs/指示書_評価ポイント.md の 6-0・6-1）。
 */
import { resolveRateAt, type EvaluationPointInputBy, type PointRateLike } from '@/lib/evaluationPoints';

export const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// ---------------------------------------------------------------- 入力

/** body が JSON のオブジェクト（配列でない）なら、その中身を返す。違えば null */
export function asObject(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/** 項目名: 文字列で、前後の空白を取って 1〜max 字のものだけ。違えば null */
export function parseName(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > max) return null;
    return trimmed;
}

/**
 * 任意の文字（説明など）: 前後の空白を取って max 字まで。空・null は null にする。
 * 文字列でも null でもない・字数の外は { ok: false }
 */
export function parseOptionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false };
    const trimmed = value.trim();
    if (trimmed.length > max) return { ok: false };
    return { ok: true, value: trimmed.length === 0 ? null : trimmed };
}

/** 付ける人: 'foreman'（職長も付けられる）か 'admin'（管理者・マネージャーだけ）。違えば null */
export function parseInputBy(value: unknown): EvaluationPointInputBy | null {
    return value === 'foreman' || value === 'admin' ? value : null;
}

// ---------------------------------------------------------------- 応答の形

/** GET /items の1行（POST・PATCH の { item } も同じ形） */
export interface ItemResponse {
    id: string;
    name: string;
    description: string | null;
    inputBy: string;
    isActive: boolean;
    sortOrder: number;
    /** 今日（日本時間）の記録に使う点数。点数の行が1つも無ければ null */
    currentPoints: number | null;
    /** 適用開始日が今日より後の行（予約）。日付の古い順 */
    upcomingRates: { id: string; points: number; effectiveFrom: string }[];
    /** この項目の記録の件数（0 のときだけ削除できる） */
    recordCount: number;
}

interface ItemRowLike {
    id: string;
    name: string;
    description: string | null;
    inputBy: string;
    isActive: boolean;
    sortOrder: number;
}

/** 予約の並び: 適用開始日の古い順（同じ日は入れた日時の古い順） */
function byEffectiveFromAsc(a: PointRateLike, b: PointRateLike): number {
    if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 項目の行と、その項目の点数の履歴（loadRatesByItemId の形）から、一覧の1行を作る */
export function toItemResponse(
    row: ItemRowLike,
    rates: readonly PointRateLike[],
    recordCount: number,
    todayKey: string,
): ItemResponse {
    const current = resolveRateAt(rates, todayKey);
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        inputBy: row.inputBy,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        currentPoints: current ? current.points : null,
        upcomingRates: rates
            .filter((r) => r.effectiveFrom > todayKey)
            .sort(byEffectiveFromAsc)
            .map((r) => ({ id: r.id, points: r.points, effectiveFrom: r.effectiveFrom })),
        recordCount,
    };
}
