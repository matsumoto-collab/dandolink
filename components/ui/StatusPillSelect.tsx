'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface StatusOption {
    value: string;
    label: string;
}

interface StatusPillSelectProps {
    /** 現在のステータス値 */
    value: string;
    /** 選択肢（value/label） */
    options: StatusOption[];
    /** 現在値のピル色クラス（例: "bg-slate-100 text-slate-600"） */
    colorClass: string;
    /** 変更時コールバック（新しい value を渡す） */
    onChange: (value: string) => void;
    /** 更新中などで一時的に無効化 */
    disabled?: boolean;
}

/**
 * バッジ風に見えるインライン・ステータス変更セレクト。
 *
 * - ネイティブ `<select>` を `appearance-none` でピル化（モバイルでは OS ピッカーが開くのでグローブ操作にも強い）。
 * - 行クリック（詳細モーダルを開く等）に伝播しないよう、ラッパーで `stopPropagation` する。
 * - 見積書一覧・請求書一覧の両方で使う共有部品。色・選択肢は呼び出し側から渡す。
 */
export default function StatusPillSelect({
    value,
    options,
    colorClass,
    onChange,
    disabled = false,
}: StatusPillSelectProps) {
    return (
        <div
            className="relative inline-flex"
            onClick={(e) => e.stopPropagation()}
        >
            <select
                value={value}
                disabled={disabled}
                aria-label="ステータスを変更"
                title="ステータスを変更"
                onChange={(e) => onChange(e.target.value)}
                className={`appearance-none cursor-pointer rounded-full pl-3 pr-7 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 disabled:cursor-wait ${colorClass}`}
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value} className="bg-white text-slate-700 font-normal">
                        {o.label}
                    </option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-60" />
        </div>
    );
}
