/**
 * 足場仕様（ProjectMaster.scaffoldingSpec）の共通ロジック。
 *
 * spec は「項目ID → 値」のフラットな JSON で、値は boolean（toggle）か string（segment/text）。
 * 補足テキストは `${itemId}__text` というキーで同じ入れ物に入る。
 *
 * 「未入力」は null / undefined / false / 空文字 のいずれかで表す。テンプレートと既定値は
 * この「未入力」を持たない＝適用しても既存の入力を消さない、という約束で成り立っている。
 */

import type { ScaffoldingSpec } from '@/types/calendar';

/** 値が実際に入力されているか（null/undefined/false/空文字は未入力）。 */
export function isSpecValueFilled(v: unknown): boolean {
    return v !== null && v !== undefined && v !== false && v !== '';
}

/** テンプレートに保存できる形へ整える。未入力の項目と、型の合わない値は落とす。 */
export function sanitizePresetSpec(raw: unknown): Record<string, boolean | string> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, boolean | string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k !== 'string' || k.length === 0 || k.length > 200) continue;
        if (!isSpecValueFilled(v)) continue;
        if (typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'string') out[k] = v.slice(0, 500);
    }
    return out;
}

/** 既定値を持つ項目（足場仕様マスタ）。 */
export interface SpecItemWithDefault {
    id: string;
    defaultValue?: boolean | string | null;
}

/**
 * 足場仕様マスタから「新規案件の初期値」を組み立てる。
 * 既定値が入っていない項目は含めない＝従来どおり未入力で開く。
 */
export function collectDefaultSpec(
    groups: Array<{ items: SpecItemWithDefault[] }>,
): ScaffoldingSpec {
    const defaults: ScaffoldingSpec = {};
    for (const g of groups) {
        for (const item of g.items ?? []) {
            if (isSpecValueFilled(item.defaultValue)) {
                defaults[item.id] = item.defaultValue as boolean | string;
            }
        }
    }
    return defaults;
}

/**
 * テンプレートを今の入力に重ねる。
 * テンプレートに入っている項目だけを上書きし、入っていない項目は今の内容をそのまま残す
 * （途中まで入力してからテンプレを当てても入力が消えないようにするため）。
 */
export function applyPresetToSpec(current: ScaffoldingSpec | undefined, preset: ScaffoldingSpec): ScaffoldingSpec {
    return { ...(current ?? {}), ...preset };
}

/**
 * 既定値を今の入力の「下敷き」にする。
 * すでに入っている値のほうを優先する＝ユーザーの入力を既定値で潰さない。
 */
export function underlayDefaults(current: ScaffoldingSpec | undefined, defaults: ScaffoldingSpec): ScaffoldingSpec {
    return { ...defaults, ...(current ?? {}) };
}

/** spec に1つでも入力があるか（既定値を流し込んでよいかの判定に使う）。 */
export function hasAnySpecValue(spec: ScaffoldingSpec | undefined): boolean {
    if (!spec) return false;
    return Object.values(spec).some(isSpecValueFilled);
}

/**
 * 既定値を項目タイプに合わせて正規化する。
 * toggle は真偽値、segment/text は文字列のみ。segment は選択肢に無い値も捨てる
 * （マスタの選択肢を直したあとに、成立しない既定値が残らないようにする）。
 * 返り値の null は「既定値なし」。
 */
export function normalizeItemDefaultValue(
    type: string,
    value: boolean | string | null | undefined,
    options?: string[] | null,
): boolean | string | null {
    if (!isSpecValueFilled(value)) return null;
    if (type === 'toggle') return typeof value === 'boolean' ? value : null;
    if (typeof value !== 'string') return null;
    if (type === 'segment') {
        return Array.isArray(options) && options.includes(value) ? value : null;
    }
    return value;
}
