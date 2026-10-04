/**
 * 手当の種類と金額の API（app/api/allowances/items 以下）の共通部品。
 * route.ts ではないので Next.js のルートにはならない（同じ階層の route から import するだけ）。
 *
 * 決まりごと（だれが何をできるか・どの金額を使うか）は lib/allowances.ts に書いてある。
 * ここには、入力の読み方と、応答の形をそろえる関数だけを置く（docs/指示書_大規模手当.md の 6-0・6-1）。
 */
import { allowanceStartDateKey, resolveAllowanceRateAt, type AllowanceRateLike } from '@/lib/allowances';

// ---------------------------------------------------------------- 入力

/** body が JSON のオブジェクト（配列でない）なら、その中身を返す。違えば null */
export function asObject(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

/** 名前: 文字列で、前後の空白を取って 1〜max 字のものだけ。違えば null */
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

// ---------------------------------------------------------------- 応答の形

/** GET /items の1行（PATCH の { item } も同じ形） */
export interface AllowanceItemResponse {
    id: string;
    name: string;
    description: string | null;
    /** 対象の現場の工事内容（例: 大規模） */
    constructionContent: string;
    isActive: boolean;
    sortOrder: number;
    /** その手当の始まりの日（いちばん古い適用開始日）。金額の行が1つも無ければ null */
    startDate: string | null;
    /** 今日（日本時間）の記録に使う金額。今日が始まりの日より前・金額の行が無いときは null */
    current: { foremanAmount: number; memberAmount: number } | null;
    /** 適用開始日が今日より後の行（予約）。日付の古い順 */
    upcomingRates: { id: string; foremanAmount: number; memberAmount: number; effectiveFrom: string }[];
    /** この手当の記録の件数 */
    recordCount: number;
}

interface ItemRowLike {
    id: string;
    name: string;
    description: string | null;
    constructionContent: string;
    isActive: boolean;
    sortOrder: number;
}

/** 予約の並び: 適用開始日の古い順（同じ日は入れた日時の古い順） */
function byEffectiveFromAsc(a: AllowanceRateLike, b: AllowanceRateLike): number {
    if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 手当の行と、その手当の金額の履歴（loadAllowanceRatesByItemId の形）から、一覧の1行を作る */
export function toAllowanceItemResponse(
    row: ItemRowLike,
    rates: readonly AllowanceRateLike[],
    recordCount: number,
    todayKey: string,
): AllowanceItemResponse {
    const current = resolveAllowanceRateAt(rates, todayKey);
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        constructionContent: row.constructionContent,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        startDate: allowanceStartDateKey(rates),
        current: current ? { foremanAmount: current.foremanAmount, memberAmount: current.memberAmount } : null,
        upcomingRates: rates
            .filter((r) => r.effectiveFrom > todayKey)
            .sort(byEffectiveFromAsc)
            .map((r) => ({ id: r.id, foremanAmount: r.foremanAmount, memberAmount: r.memberAmount, effectiveFrom: r.effectiveFrom })),
        recordCount,
    };
}
