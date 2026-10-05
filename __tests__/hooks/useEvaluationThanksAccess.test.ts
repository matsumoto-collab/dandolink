/**
 * hooks/useEvaluationThanksAccess.ts（評価ポイント「ありがとう」を送れるか）のテスト。
 *   worker・foreman1・foreman2 → GET /api/evaluation-points/thanks/access を1回だけ読む（読めるまで・失敗は false）
 *   admin・manager・それ以外 → 通信せずに false
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useEvaluationThanksAccess } from '@/hooks/useEvaluationThanksAccess';

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

const okJson = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('useEvaluationThanksAccess', () => {
    it('admin・manager は通信せずに false', () => {
        for (const role of ['admin', 'manager', 'ADMIN', 'Manager']) {
            const { result } = renderHook(() => useEvaluationThanksAccess(role));
            expect(result.current).toEqual({ enabled: false, loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('協力会社・税理士・経理・ロールなしは通信せずに false', () => {
        for (const role of ['partner', 'partner_member', 'support', 'accountant', undefined, null, '']) {
            const { result } = renderHook(() => useEvaluationThanksAccess(role));
            expect(result.current).toEqual({ enabled: false, loading: false });
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('worker は読めるまで false（読み込み中）→ 読めたら enabled。読むのは1回だけ', async () => {
        fetchMock.mockReturnValue(okJson({ enabled: true }));
        const { result, rerender } = renderHook(() => useEvaluationThanksAccess('worker'));
        expect(result.current).toEqual({ enabled: false, loading: true });
        await waitFor(() => expect(result.current).toEqual({ enabled: true, loading: false }));
        rerender();
        rerender();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/evaluation-points/thanks/access');
    });

    it('foreman1・foreman2（大文字まじりも）も読む。使わない設定なら false', async () => {
        for (const role of ['foreman1', 'FOREMAN2']) {
            fetchMock.mockReset();
            fetchMock.mockReturnValue(okJson({ enabled: false }));
            const { result } = renderHook(() => useEvaluationThanksAccess(role));
            await waitFor(() => expect(result.current).toEqual({ enabled: false, loading: false }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it('失敗したとき（HTTP エラー・通信エラー・true でない値）は false', async () => {
        for (const respond of [
            () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ enabled: true }) }),
            () => Promise.reject(new Error('network')),
            () => okJson({ enabled: 'yes' }),
        ]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(respond);
            const { result } = renderHook(() => useEvaluationThanksAccess('foreman2'));
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.enabled).toBe(false);
        }
    });
});
