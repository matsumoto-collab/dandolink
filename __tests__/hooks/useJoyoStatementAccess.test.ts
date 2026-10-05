/**
 * hooks/useJoyoStatementAccess.ts（「支払明細書」の見せ方）のテスト。
 *   admin → 通信せずに 'admin'
 *   manager・foreman1・foreman2・worker → GET /api/joyo-statements/access を1回だけ読む（読めるまで・失敗は 'none'）
 *   それ以外 → 通信せずに 'none'
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useJoyoStatementAccess } from '@/hooks/useJoyoStatementAccess';

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('useJoyoStatementAccess', () => {
    it('admin（大文字まじりも）は通信せずに admin', () => {
        for (const role of ['admin', 'ADMIN', 'Admin']) {
            const { result } = renderHook(() => useJoyoStatementAccess(role));
            expect(result.current).toEqual({ mode: 'admin', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('協力会社・協力会社のメンバー・応援・税理士・ロールなしは通信せずに none', () => {
        for (const role of ['partner', 'PARTNER', 'partner_member', 'support', 'accountant', undefined, null, '']) {
            const { result } = renderHook(() => useJoyoStatementAccess(role));
            expect(result.current).toEqual({ mode: 'none', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('worker は読めるまで none（読み込み中）→ 読めたら mode。読むのは1回だけ', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'member' }));
        const { result, rerender } = renderHook(() => useJoyoStatementAccess('worker'));
        expect(result.current).toEqual({ mode: 'none', loading: true });
        await waitFor(() => expect(result.current).toEqual({ mode: 'member', loading: false }));
        rerender();
        rerender();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/joyo-statements/access');
    });

    it('manager・職長（foreman1・foreman2・大文字まじり）も読む。対象者なら member', async () => {
        for (const role of ['manager', 'foreman1', 'foreman2', 'FOREMAN1', 'Manager']) {
            fetchMock.mockReset();
            fetchMock.mockReturnValue(okJson({ mode: 'member' }));
            const { result } = renderHook(() => useJoyoStatementAccess(role));
            await waitFor(() => expect(result.current).toEqual({ mode: 'member', loading: false }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe('/api/joyo-statements/access');
        }
    });

    it('対象者でなければ none', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'none' }));
        const { result } = renderHook(() => useJoyoStatementAccess('foreman1'));
        await waitFor(() => expect(result.current).toEqual({ mode: 'none', loading: false }));
    });

    it('失敗したとき（HTTP エラー・通信エラー・知らない値）は none', async () => {
        for (const respond of [
            () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
            () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: '認証が必要です' }) }),
            () => Promise.reject(new Error('network')),
            () => okJson({ mode: 'everything' }),
            () => okJson({}),
        ]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(respond);
            const { result } = renderHook(() => useJoyoStatementAccess('foreman2'));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.mode).toBe('none');
        }
    });
});
