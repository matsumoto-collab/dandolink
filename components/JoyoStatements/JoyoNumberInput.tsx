'use client';

import React, { useState } from 'react';

interface JoyoNumberInputProps {
    id?: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    /** 小数を通すか（数量＝true／単価＝false＝整数） */
    allowDecimal?: boolean;
    /** 入力を確定したとき（フォーカスを外したとき）に通す丸め。数量は roundQuantity を渡す */
    roundOnCommit?: (value: number) => number;
    /** 3桁区切りで表示する（金額欄） */
    comma?: boolean;
    maxLength?: number;
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
    readOnly?: boolean;
    invalid?: boolean;
}

/**
 * 全角の数字・小数点・マイナス（日本語入力がオンのまま打った「２２．５」「－１０００」）を半角に直し、
 * カンマと空白を落とす。
 */
export function normalizeSignedDecimalText(raw: string): string {
    return raw
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[．。]/g, '.')
        .replace(/[－ー−‐―]/g, '-')
        .replace(/[，、　\s,]/g, '');
}

/**
 * 小数とマイナスを通す数値入力（支払明細書の数量・単価用）。
 *
 * components/OrderBacklog/NumberInput.tsx と同じく `type="text"` を使う
 * （`type="number"` はスマホで一度空にすると 0 に戻る事故があるため）。
 * 既存の NumberInput は 0 以上の整数だけなので、小数（0.5 日）とマイナス（差し引きの行）を通すために別に作った。
 *
 * - 入力中は打った文字をそのまま見せ、読める数になったら onChange で親に渡す（「-」「1.」の途中も消さない）
 * - フォーカスを外したら min〜max に収め、roundOnCommit で丸めた値を確定する
 */
export default function JoyoNumberInput({
    id,
    value,
    onChange,
    min,
    max,
    allowDecimal = false,
    roundOnCommit,
    comma = false,
    maxLength,
    className = '',
    ariaLabel,
    disabled,
    readOnly,
    invalid,
}: JoyoNumberInputProps) {
    const [draft, setDraft] = useState<string | null>(null);

    const formatted = comma ? value.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : String(value);
    const display = draft ?? formatted;

    /** 文字列を数にする。読めなければ null（「-」「.」だけ・空のとき） */
    const parse = (raw: string): number | null => {
        let text = normalizeSignedDecimalText(raw);
        if (min >= 0) text = text.replace(/-/g, '');
        if (!allowDecimal) text = text.replace(/\..*$/, '');
        const pattern = allowDecimal ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
        if (!pattern.test(text)) return null;
        if (text === '' || text === '-' || text === '.' || text === '-.') return null;
        const n = Number(text);
        return Number.isFinite(n) ? n : null;
    };

    const clamp = (n: number) => Math.min(max, Math.max(min, n));

    const commit = () => {
        const parsed = draft === null ? value : parse(draft);
        let next = clamp(parsed ?? 0);
        if (!allowDecimal) next = Math.round(next);
        if (roundOnCommit) next = roundOnCommit(next);
        // -0 を 0 に直す
        next = next || 0;
        if (next !== value) onChange(next);
        setDraft(null);
    };

    return (
        <input
            id={id}
            type="text"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            aria-label={ariaLabel}
            disabled={disabled}
            readOnly={readOnly}
            maxLength={maxLength}
            value={display}
            onChange={(e) => {
                const raw = e.target.value;
                setDraft(raw);
                const parsed = parse(raw);
                if (parsed !== null) onChange(clamp(allowDecimal ? parsed : Math.trunc(parsed)));
            }}
            onFocus={(e) => {
                if (!readOnly) e.currentTarget.select();
            }}
            onBlur={() => {
                if (!readOnly) commit();
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className={`px-1.5 py-1 text-right tabular-nums border rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-100 read-only:bg-slate-50 read-only:text-slate-700 ${
                invalid ? 'border-red-400 bg-red-50' : 'border-slate-300'
            } ${className}`}
        />
    );
}
