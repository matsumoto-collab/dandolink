'use client';

import React from 'react';

/** 工事種別 ID → 名称・色（/api/master-data/construction-types 由来）。 */
export type CtypeMap = Record<string, { name: string; color: string }>;

/** マスタに無いレガシー工事種別値のフォールバック（マスタ既定色に合わせる）。 */
export const LEGACY_CTYPE: Record<string, { name: string; color: string }> = {
    assembly: { name: '組立', color: '#a8c8e8' },
    demolition: { name: '解体', color: '#f0a8a8' },
    other: { name: 'その他', color: '#fef08a' },
};

/** 工事種別 ID を名称・色へ解決する。未知の値は ID をそのまま名称に使う。 */
export function resolveCtype(id: string, map: CtypeMap): { name: string; color: string } {
    return map[id] ?? LEGACY_CTYPE[id] ?? { name: id, color: '#94a3b8' };
}

/** 工事種別の名称（絞り込みの突き合わせ用。マスタに同名が複数あるため名前で比較する）。 */
export function ctypeName(id: string | null | undefined, map: CtypeMap): string {
    if (!id) return '';
    return resolveCtype(id, map).name;
}

/** 工事種別チップ（マスタ色のドット＋名称）。 */
export default function CTypeChip({ id, map, small }: { id: string; map: CtypeMap; small?: boolean }) {
    const c = resolveCtype(id, map);
    return (
        <span
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium ${
                small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[10px]'
            }`}
            style={{ borderColor: c.color, backgroundColor: `${c.color}22`, color: '#334155' }}
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
            {c.name}
        </span>
    );
}
