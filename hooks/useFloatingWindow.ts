'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** 画面内フローティングウインドウの位置とサイズ（px） */
export interface FloatingWindowRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** リサイズできる角（右下 / 左下） */
export type FloatingWindowCorner = 'se' | 'sw';

/** 位置・サイズの保存先（キーを変えると保存済みの値は捨てられる） */
const STORAGE_KEY = 'dandolink:chatWindow:v1';

/** 最小サイズ（これ以下には縮められない） */
const MIN_W = 320;
const MIN_H = 360;
/** ビューポート端に必ず残す余白。最大サイズは「ビューポート − この余白×2」 */
const MARGIN = 16;

/** 既定サイズ・既定位置（右下） */
const DEFAULT_W = 420;
const DEFAULT_H = 600;
const DEFAULT_GAP = 24;

interface Gesture {
    pointerId: number;
    mode: 'drag' | 'resize';
    corner: FloatingWindowCorner;
    startX: number;
    startY: number;
    /** 掴んだ時点の位置・サイズ。移動量はここからの差分で出す（誤差の蓄積を防ぐ） */
    origin: FloatingWindowRect;
}

/** ドラッグ／リサイズのハンドルに展開する props */
export interface FloatingWindowHandleProps {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void;
}

interface UseFloatingWindowResult {
    /** 現在の位置・サイズ。style の left/top/width/height にそのまま渡す */
    rect: FloatingWindowRect;
    /** ドラッグ or リサイズ中（本文を pointer-events-none にして誤操作を防ぐ用） */
    isInteracting: boolean;
    /** ヘッダーに展開する（ドラッグで移動） */
    dragHandleProps: FloatingWindowHandleProps;
    /** 角のハンドルに展開する（リサイズ） */
    getResizeHandleProps: (corner: FloatingWindowCorner) => FloatingWindowHandleProps;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** ビューポートからはみ出さないように位置・サイズを収める */
function clampRect(rect: FloatingWindowRect, vw: number, vh: number): FloatingWindowRect {
    const w = clamp(rect.w, MIN_W, Math.max(MIN_W, vw - MARGIN * 2));
    const h = clamp(rect.h, MIN_H, Math.max(MIN_H, vh - MARGIN * 2));
    const x = clamp(rect.x, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
    const y = clamp(rect.y, MARGIN, Math.max(MARGIN, vh - h - MARGIN));
    return { x, y, w, h };
}

/** 既定は右下。高さは画面が低いときに縮める */
function defaultRect(vw: number, vh: number): FloatingWindowRect {
    const w = DEFAULT_W;
    const h = Math.min(DEFAULT_H, vh - 80);
    return { x: vw - w - DEFAULT_GAP, y: vh - h - DEFAULT_GAP, w, h };
}

function loadRect(vw: number, vh: number): FloatingWindowRect {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<FloatingWindowRect>;
            if (
                typeof parsed.x === 'number' && Number.isFinite(parsed.x) &&
                typeof parsed.y === 'number' && Number.isFinite(parsed.y) &&
                typeof parsed.w === 'number' && Number.isFinite(parsed.w) &&
                typeof parsed.h === 'number' && Number.isFinite(parsed.h)
            ) {
                return clampRect(parsed as FloatingWindowRect, vw, vh);
            }
        }
    } catch {
        /* 壊れた保存値・localStorage 不可の環境は既定値で続行 */
    }
    return clampRect(defaultRect(vw, vh), vw, vh);
}

/**
 * 画面内フローティングウインドウ（移動・リサイズ・localStorage 保存）。
 * 位置は fixed + left/top/width/height で指定する前提（transform は使わない）。
 * transform を掛けると中の fixed 配置ポップオーバーの基準がずれて壊れるため。
 *
 * @param enabled フローティング表示中だけ true（docked / スマホでは無効）
 */
export function useFloatingWindow(enabled: boolean): UseFloatingWindowResult {
    const [rect, setRect] = useState<FloatingWindowRect>(() => {
        if (typeof window === 'undefined') return { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
        return loadRect(window.innerWidth, window.innerHeight);
    });
    const [isInteracting, setIsInteracting] = useState(false);
    const gestureRef = useRef<Gesture | null>(null);

    // ウインドウサイズが変わったら枠内へ収め直す
    useEffect(() => {
        if (!enabled) return;
        const onResize = () => {
            setRect((prev) => clampRect(prev, window.innerWidth, window.innerHeight));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [enabled]);

    // 保存（ドラッグ中の連続更新でも書き込みが暴れないよう少し待つ）
    useEffect(() => {
        if (!enabled) return;
        const timer = setTimeout(() => {
            try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
            } catch {
                /* localStorage 不可（プライベートモード等）は保存しないだけ */
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [enabled, rect]);

    const endGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        gestureRef.current = null;
        setIsInteracting(false);
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
    }, []);

    const handleMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== e.pointerId) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        const origin = gesture.origin;

        if (gesture.mode === 'drag') {
            setRect(clampRect({ ...origin, x: origin.x + dx, y: origin.y + dy }, vw, vh));
            return;
        }

        const h = clamp(origin.h + dy, MIN_H, Math.max(MIN_H, vh - MARGIN - origin.y));
        if (gesture.corner === 'se') {
            const w = clamp(origin.w + dx, MIN_W, Math.max(MIN_W, vw - MARGIN - origin.x));
            setRect({ ...origin, w, h });
        } else {
            // 左下: 右辺を固定したまま左へ広げる（x と w を同時に動かす）
            const right = origin.x + origin.w;
            const w = clamp(origin.w - dx, MIN_W, Math.max(MIN_W, right - MARGIN));
            setRect({ ...origin, x: right - w, w, h });
        }
    }, []);

    const startGesture = useCallback(
        (e: React.PointerEvent<HTMLElement>, mode: 'drag' | 'resize', corner: FloatingWindowCorner) => {
            if (gestureRef.current) return;
            // ヘッダー内のボタン（モード切替・閉じる等）を潰さない
            if (mode === 'drag') {
                const target = e.target as HTMLElement | null;
                if (target && typeof target.closest === 'function' && target.closest('button')) return;
            }
            e.preventDefault();
            gestureRef.current = {
                pointerId: e.pointerId,
                mode,
                corner,
                startX: e.clientX,
                startY: e.clientY,
                origin: rect,
            };
            setIsInteracting(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
        },
        [rect]
    );

    const dragHandleProps: FloatingWindowHandleProps = useMemo(
        () => ({
            onPointerDown: (e) => startGesture(e, 'drag', 'se'),
            onPointerMove: handleMove,
            onPointerUp: endGesture,
            onPointerCancel: endGesture,
            onLostPointerCapture: endGesture,
        }),
        [startGesture, handleMove, endGesture]
    );

    const getResizeHandleProps = useCallback(
        (corner: FloatingWindowCorner): FloatingWindowHandleProps => ({
            onPointerDown: (e) => startGesture(e, 'resize', corner),
            onPointerMove: handleMove,
            onPointerUp: endGesture,
            onPointerCancel: endGesture,
            onLostPointerCapture: endGesture,
        }),
        [startGesture, handleMove, endGesture]
    );

    return { rect, isInteracting, dragHandleProps, getResizeHandleProps };
}
