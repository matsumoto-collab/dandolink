'use client';

import React, { useState } from 'react';

interface NumberInputProps {
    id?: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    className?: string;
    /** 3桁区切りで表示する（金額欄） */
    comma?: boolean;
    ariaLabel?: string;
    disabled?: boolean;
}

/** 全角数字（日本語入力がオンのまま打った「５００」）を半角に直す。全角カンマ・全角スペースも落とす。 */
export function normalizeNumericText(raw: string): string {
    return raw
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[，、　\s,]/g, '');
}

/**
 * 数値入力。`type="number"` はスマホで一度空にすると 0 に戻る事故があるため、
 * 既存方針どおり `type="text" inputMode="numeric"` を使う。
 * 入力中は生の文字列を保持し、フォーカスを外したら整形した値に戻す。
 * PC では inputMode が IME を切ってくれないので、全角で打たれた数字も受け付ける
 * （半角以外を捨てると「金額を入れても 0 に戻る」ように見える）。
 */
export default function NumberInput({
    id,
    value,
    onChange,
    min = 0,
    max,
    className = '',
    comma = false,
    ariaLabel,
    disabled,
}: NumberInputProps) {
    const [draft, setDraft] = useState<string | null>(null);

    const formatted = comma ? value.toLocaleString() : String(value);
    const display = draft ?? formatted;

    const commit = (raw: string) => {
        const digits = normalizeNumericText(raw).replace(/[^0-9]/g, '');
        const parsed = digits === '' ? 0 : Number(digits);
        let next = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
        if (next < min) next = min;
        if (max != null && next > max) next = max;
        onChange(next);
    };

    return (
        <input
            id={id}
            type="text"
            inputMode="numeric"
            aria-label={ariaLabel}
            disabled={disabled}
            value={display}
            onChange={(e) => {
                setDraft(e.target.value);
                commit(e.target.value);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setDraft(null)}
            className={`px-1.5 py-1 text-right border border-slate-300 rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-100 ${className}`}
        />
    );
}
