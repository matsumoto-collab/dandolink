import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '@/hooks/useLocalStorage';

describe('useLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });

    it('初期値を返す（localStorageが空の場合）', () => {
        const { result } = renderHook(() => useLocalStorage('testKey', 'default'));
        expect(result.current[0]).toBe('default');
    });

    it('localStorageに保存された値を返す', () => {
        localStorage.setItem('testKey', JSON.stringify('stored'));
        const { result } = renderHook(() => useLocalStorage('testKey', 'default'));
        expect(result.current[0]).toBe('stored');
    });

    it('setValueで値を更新できる', () => {
        const { result } = renderHook(() => useLocalStorage('testKey', 'initial'));

        act(() => {
            result.current[1]('updated');
        });

        expect(result.current[0]).toBe('updated');
        expect(JSON.parse(localStorage.getItem('testKey')!)).toBe('updated');
    });

    it('関数でsetValueできる', () => {
        const { result } = renderHook(() => useLocalStorage('count', 0));

        act(() => {
            result.current[1]((prev) => prev + 1);
        });

        expect(result.current[0]).toBe(1);
    });

    it('オブジェクトを保存・取得できる', () => {
        const obj = { name: 'test', value: 123 };
        const { result } = renderHook(() => useLocalStorage('objKey', {}));

        act(() => {
            result.current[1](obj);
        });

        expect(result.current[0]).toEqual(obj);
    });

    it('配列を保存・取得できる', () => {
        const arr = [1, 2, 3];
        const { result } = renderHook(() => useLocalStorage('arrKey', [] as number[]));

        act(() => {
            result.current[1](arr);
        });

        expect(result.current[0]).toEqual(arr);
    });

    it('Date型を復元できる', () => {
        const dateStr = '2026-01-15T10:30:00.000Z';
        localStorage.setItem('dateKey', JSON.stringify({ date: dateStr }));

        const { result } = renderHook(() => useLocalStorage('dateKey', { date: new Date() }));

        expect(result.current[0].date).toBeInstanceOf(Date);
    });

    it('不正なJSONでは初期値を返す', () => {
        localStorage.setItem('badKey', 'not-valid-json');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const { result } = renderHook(() => useLocalStorage('badKey', 'default'));

        expect(result.current[0]).toBe('default');
        consoleSpy.mockRestore();
    });
});
