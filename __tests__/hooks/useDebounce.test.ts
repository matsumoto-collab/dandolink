import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '@/hooks/useDebounce';

describe('useDebounce', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('初期値を返す', () => {
        const { result } = renderHook(() => useDebounce('initial', 500));
        expect(result.current).toBe('initial');
    });

    it('遅延前は古い値を返す', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 500 } }
        );

        rerender({ value: 'updated', delay: 500 });

        // まだ遅延時間が経過していないので古い値
        expect(result.current).toBe('initial');
    });

    it('遅延後に新しい値を返す', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 500 } }
        );

        rerender({ value: 'updated', delay: 500 });

        act(() => {
            jest.advanceTimersByTime(500);
        });

        expect(result.current).toBe('updated');
    });

    it('連続した更新では最後の値のみが反映される', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 'initial', delay: 500 } }
        );

        rerender({ value: 'first', delay: 500 });
        act(() => { jest.advanceTimersByTime(200); });

        rerender({ value: 'second', delay: 500 });
        act(() => { jest.advanceTimersByTime(200); });

        rerender({ value: 'third', delay: 500 });
        act(() => { jest.advanceTimersByTime(500); });

        expect(result.current).toBe('third');
    });

    it('数値でも動作する', () => {
        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: 0, delay: 300 } }
        );

        rerender({ value: 42, delay: 300 });

        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(result.current).toBe(42);
    });

    it('オブジェクトでも動作する', () => {
        const initial = { name: 'test' };
        const updated = { name: 'updated' };

        const { result, rerender } = renderHook(
            ({ value, delay }) => useDebounce(value, delay),
            { initialProps: { value: initial, delay: 300 } }
        );

        rerender({ value: updated, delay: 300 });

        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(result.current).toEqual(updated);
    });
});
