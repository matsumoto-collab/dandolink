import { renderHook, act } from '@testing-library/react';
import { useIsMobile, useIsTablet, useIsSmartphone } from '@/hooks/useIsMobile';

describe('useIsMobile', () => {
    const originalInnerWidth = window.innerWidth;

    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', {
            writable: true,
            configurable: true,
            value: 1200,
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', {
            writable: true,
            configurable: true,
            value: originalInnerWidth,
        });
    });

    it('デスクトップサイズではfalseを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1200 });
        const { result } = renderHook(() => useIsMobile());
        expect(result.current).toBe(false);
    });

    it('モバイルサイズではtrueを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 800 });
        const { result } = renderHook(() => useIsMobile());
        expect(result.current).toBe(true);
    });

    it('カスタムブレークポイントで判定できる', () => {
        Object.defineProperty(window, 'innerWidth', { value: 500 });
        const { result } = renderHook(() => useIsMobile(600));
        expect(result.current).toBe(true);
    });

    it('リサイズイベントで更新される', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1200 });
        const { result } = renderHook(() => useIsMobile());

        expect(result.current).toBe(false);

        act(() => {
            Object.defineProperty(window, 'innerWidth', { value: 800 });
            window.dispatchEvent(new Event('resize'));
        });

        expect(result.current).toBe(true);
    });
});

describe('useIsTablet', () => {
    it('768px未満でtrueを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 600 });
        const { result } = renderHook(() => useIsTablet());
        expect(result.current).toBe(true);
    });

    it('768px以上でfalseを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 800 });
        const { result } = renderHook(() => useIsTablet());
        expect(result.current).toBe(false);
    });
});

describe('useIsSmartphone', () => {
    it('640px未満でtrueを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 400 });
        const { result } = renderHook(() => useIsSmartphone());
        expect(result.current).toBe(true);
    });

    it('640px以上でfalseを返す', () => {
        Object.defineProperty(window, 'innerWidth', { value: 700 });
        const { result } = renderHook(() => useIsSmartphone());
        expect(result.current).toBe(false);
    });
});
