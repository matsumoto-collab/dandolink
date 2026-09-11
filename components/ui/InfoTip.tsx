'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const TIP_WIDTH = 300;
const MARGIN = 8;
/** 下にこれだけ余白が無ければ上に出す（説明文 4〜5 行ぶんの目安） */
const MIN_SPACE_BELOW = 180;

interface InfoTipProps {
    /** 吹き出しの見出し（例: 一人当たりの稼ぎ） */
    title: string;
    /** 説明文 */
    children: ReactNode;
    className?: string;
}

/**
 * 語句の横に置く (i) アイコン。マウスを乗せる・キーボードでフォーカスする・タップすると説明が出る。
 *
 * 案件詳細はモーダル（z-[60]）の中のスクロール領域にあるので、position:absolute の吹き出しだと
 * 切れたり後ろに隠れたりする。Portal で body 直下に fixed で描く
 * （InvoicePaymentHistoryHover と同じ作法）。モーダルの上の小モーダル（z-[70]）より前に出す。
 * タッチ端末には hover が無いので、タップで開閉でき、外側をタップするかスクロールすると閉じる。
 */
export default function InfoTip({ title, children, className = '' }: InfoTipProps) {
    const [style, setStyle] = useState<CSSProperties | null>(null);
    // クリック（タップ）で開いたときは、マウスが離れても閉じない
    const [pinned, setPinned] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const tipId = useId();

    const open = useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(TIP_WIDTH, vw - MARGIN * 2);
        const left = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, vw - width - MARGIN));
        const spaceBelow = vh - rect.bottom;
        if (spaceBelow >= MIN_SPACE_BELOW || spaceBelow >= rect.top) {
            setStyle({ top: rect.bottom + 6, left, width });
        } else {
            setStyle({ bottom: vh - rect.top + 6, left, width });
        }
    }, []);

    const close = useCallback(() => {
        setStyle(null);
        setPinned(false);
    }, []);

    // 開いている間は、スクロールか外側のタップで閉じる（位置がずれたまま残らないように）
    useEffect(() => {
        if (!style) return;
        const onScroll = () => close();
        const onPointerDown = (e: PointerEvent) => {
            if (buttonRef.current?.contains(e.target as Node)) return;
            close();
        };
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('scroll', onScroll, { capture: true });
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [style, close]);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label={`${title}の説明`}
                aria-describedby={style ? tipId : undefined}
                className={`inline-flex items-center justify-center rounded-full align-middle text-slate-400 hover:text-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${className}`}
                onMouseEnter={open}
                onMouseLeave={() => {
                    if (!pinned) setStyle(null);
                }}
                onFocus={open}
                onBlur={close}
                onClick={(e) => {
                    // 並び替えできる列見出しなどの中に置いても、親のクリックを発火させない
                    e.stopPropagation();
                    if (pinned) {
                        close();
                    } else {
                        open();
                        setPinned(true);
                    }
                }}
            >
                <Info className="w-3.5 h-3.5" />
            </button>
            {style &&
                createPortal(
                    <div
                        id={tipId}
                        role="tooltip"
                        className="fixed z-[80] pointer-events-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-xl"
                        style={style}
                    >
                        <p className="mb-1 text-xs font-semibold text-slate-800">{title}</p>
                        <div className="text-xs leading-relaxed text-slate-600">{children}</div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
