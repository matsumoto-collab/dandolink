import { fetchWithTimeout, FetchTimeoutError, FETCH_TIMEOUT_MS } from '@/lib/fetchWithTimeout';

global.fetch = jest.fn();

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('正常応答をそのまま返す', async () => {
    const mockResponse = { ok: true };
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

    const result = await fetchWithTimeout('/api/test', { cache: 'no-store' });

    expect(result).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
  });

  it('タイムアウト時は FetchTimeoutError を投げる', async () => {
    // 実際の fetch と同様、渡された signal の中断で AbortError を投げるモック
    (global.fetch as jest.Mock).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        })
    );

    const promise = fetchWithTimeout('/api/test');
    const assertion = expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
    jest.advanceTimersByTime(FETCH_TIMEOUT_MS);
    await assertion;
  });

  it('呼び出し元 signal による中断は AbortError のまま透過する（連打キャンセルと区別）', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        })
    );

    const outer = new AbortController();
    const promise = fetchWithTimeout('/api/test', { signal: outer.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    outer.abort();
    await assertion;
  });

  it('timeoutMs を指定するとその時間で打ち切る', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        })
    );

    const promise = fetchWithTimeout('/api/test', { timeoutMs: 5000 });
    const assertion = expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
    jest.advanceTimersByTime(5000);
    await assertion;
  });
});
