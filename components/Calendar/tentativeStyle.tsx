import React from 'react';

/**
 * 仮予定（dateStatus='tentative'）の視覚表現。
 *
 * カレンダーカードの色は工事種別マスタの色（ユーザー変更可能）なので、
 * 仮予定に固有の色相を割り当てるとどれかの種別色と必ず衝突する。
 * そのため「新しい色相は増やさない」方針で、種別色の上に色相中立の
 * 半透明斜線を重ね、文字バッジ「仮」で判別する（色覚多様性にも強い）。
 */

/** カードの style.backgroundImage に合成する斜線パターン（backgroundColor の上・文字の下に描画される） */
export const TENTATIVE_STRIPE_BG =
    'repeating-linear-gradient(-45deg, rgba(255,255,255,0.5) 0, rgba(255,255,255,0.5) 4px, transparent 4px, transparent 10px)';

/** カード内タイトル行の先頭に置く「仮」バッジ */
export function TentativeBadge({ className = '' }: { className?: string }) {
    return (
        <span
            className={`inline-block align-middle mr-0.5 px-0.5 rounded bg-white/90 border border-slate-500 text-slate-800 text-[9px] font-bold leading-tight ${className}`}
        >
            仮
        </span>
    );
}
