/**
 * hooks/useEvaluationPointAccess.ts（「評価ポイント」の見せ方。docs/指示書_評価ポイント.md の 7-4）のテスト。
 *   admin・manager → 通信せずに 'manager'
 *   worker・foreman1・foreman2 → GET /api/evaluation-points/access を1回だけ読む（読めるまで・失敗は 'none'）
 *   それ以外 → 通信せずに 'none'
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useEvaluationPointAccess } from '@/hooks/useEvaluationPointAccess';

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('useEvaluationPointAccess', () => {
    it('admin・manager は通信せずに manager', () => {
        for (const role of ['admin', 'manager', 'ADMIN']) {
            const { result } = renderHook(() => useEvaluationPointAccess(role));
            expect(result.current).toEqual({ mode: 'manager', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('協力会社・税理士・ロールなしは通信せずに none', () => {
        for (const role of ['partner', 'partner_member', 'support', 'accountant', undefined, null, '']) {
            const { result } = renderHook(() => useEvaluationPointAccess(role));
            expect(result.current).toEqual({ mode: 'none', loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('worker は読めるまで none（読み込み中）→ 読めたら mode。読むのは1回だけ', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'member' }));
        const { result, rerender } = renderHook(() => useEvaluationPointAccess('worker'));
        expect(result.current).toEqual({ mode: 'none', loading: true });
        await waitFor(() => expect(result.current).toEqual({ mode: 'member', loading: false }));
        rerender();
        rerender();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/evaluation-points/access');
    });

    it('職長は公開がオフなら none', async () => {
        fetchMock.mockReturnValue(okJson({ mode: 'none' }));
        const { result } = renderHook(() => useEvaluationPointAccess('foreman1'));
        await waitFor(() => expect(result.current).toEqual({ mode: 'none', loading: false }));
    });

    it('失敗したとき（HTTP エラー・通信エラー・知らない値）は none', async () => {
        for (const respond of [
            () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
            () => Promise.reject(new Error('network')),
            () => okJson({ mode: 'everything' }),
        ]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(respond);
            const { result } = renderHook(() => useEvaluationPointAccess('foreman2'));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.mode).toBe('none');
        }
    });
});
