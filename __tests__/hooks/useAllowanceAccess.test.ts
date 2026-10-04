/**
 * hooks/useAllowanceAccess.ts（「手当」の見せ方。docs/指示書_大規模手当.md の 6-7・7-4）のテスト。
 *   admin・manager → 通信せずに 'manager'
 *   worker・foreman1・foreman2 → GET /api/allowances/access を1回だけ読む（読めるまで・失敗は 'none'）
 *   それ以外 → 通信せずに 'none'
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useAllowanceAccess } from '@/hooks/useAllowanceAccess';

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('useAllowanceAccess', () => {
    it('admin・manager は通信せずに manager', () => {
        for (const role of ['admin', 'manager', 'ADMIN', 'Manager']) {
            const { result } = renderHook(() => useAllowanceAccess(role));
            expect(result.current).toEqual({ mode: 'manager', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('協力会社・協力会社のメンバー・応援・税理士・ロールなしは通信せずに none', () => {
        for (const role of ['partner', 'PARTNER', 'partner_member', 'support', 'accountant', undefined, null, '']) {
            const { result } = renderHook(() => useAllowanceAccess(role));
            expect(result.current).toEqual({ mode: 'none', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('worker は読めるまで none（読み込み中）→ 読めたら mode。読むのは1回だけ', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'member' }));
        const { result, rerender } = renderHook(() => useAllowanceAccess('worker'));
        expect(result.current).toEqual({ mode: 'none', loading: true });
        await waitFor(() => expect(result.current).toEqual({ mode: 'member', loading: false }));
        rerender();
        rerender();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/allowances/access');
    });

    it('職長（foreman1・foreman2・大文字まじり）も読む。公開がオンなら member', async () => {
        for (const role of ['foreman1', 'foreman2', 'FOREMAN1']) {
            fetchMock.mockReset();
            fetchMock.mockReturnValue(okJson({ mode: 'member' }));
            const { result } = renderHook(() => useAllowanceAccess(role));
            await waitFor(() => expect(result.current).toEqual({ mode: 'member', loading: false }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe('/api/allowances/access');
        }
    });

    it('職長は公開がオフなら none', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'none' }));
        const { result } = renderHook(() => useAllowanceAccess('foreman1'));
        await waitFor(() => expect(result.current).toEqual({ mode: 'none', loading: false }));
    });

    it('失敗したとき（HTTP エラー・通信エラー・知らない値）は none', async () => {
        for (const respond of [
            () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
            () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: '権限がありません' }) }),
            () => Promise.reject(new Error('network')),
            () => okJson({ mode: 'everything' }),
            () => okJson({}),
        ]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(respond);
            const { result } = renderHook(() => useAllowanceAccess('foreman2'));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.mode).toBe('none');
        }
    });
});
