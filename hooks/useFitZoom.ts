'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 画面幅オートフィット用フック。
 *
 * 返り値の `ref` を「利用可能な横幅いっぱいに広がる（ズームの影響を受けない）プローブ要素」に付ける。
 * そのプローブの実幅 W を測り、基準幅 `designWidth` に満たない分だけ縮小率 `zoom`(<1) を返す。
 *
 * 呼び出し側は対象コンテナに `style={{ zoom, width: `${100/zoom}%`, height: `${100/zoom}%` }}` を当てることで、
 * 「論理的に designWidth 相当の広いレイアウトを描画 → 実画面幅へ縮小表示」を実現する。
 * W >= designWidth のとき zoom=1（縮小なし＝従来どおり flex で横いっぱいに伸びる）。
 *
 * `zoom` は transform:scale と異なり再レイアウトされるため、getBoundingClientRect ／ ポインタ座標が
 * 一致し、dnd-kit のドラッグ＆ドロップが破綻しない（最新 Chromium / Edge）。
 */
export function useFitZoom(designWidth: number, minZoom = 0.5) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [zoom, setZoom] = useState(1);

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const w = el.clientWidth;
        if (!w) return;
        const next = w >= designWidth ? 1 : Math.max(minZoom, w / designWidth);
        // 微小変化での再レンダー（および丸め誤差による発振）を抑制
        setZoom(prev => (Math.abs(prev - next) > 0.005 ? next : prev));
    }, [designWidth, minZoom]);

    useEffect(() => {
        measure();
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure]);

    return { ref, zoom };
}
