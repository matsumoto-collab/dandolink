/**
 * タイムアウト付き fetch
 *
 * カレンダー初回ロードのゲートに絡むフェッチは、レスポンスが返らないまま
 * ストールすると(ブラウザ既定のタイムアウトは数分)ローディングが解除できず
 * 画面が固まる。ここで一定時間で打ち切り、各ストアの既存エラー経路
 * (initialized を立てて空表示にフォールバック)へ流す。
 *
 * 呼び出し元が signal を渡している場合(連打キャンセル用の AbortController)は
 * それも尊重する。タイムアウト由来の中断は FetchTimeoutError に変換し、
 * 「新しいリクエストによるキャンセル(AbortError)」と区別できるようにする。
 */

export const FETCH_TIMEOUT_MS = 15_000;

export class FetchTimeoutError extends Error {
    constructor(url: string, timeoutMs: number) {
        super(`Fetch timed out after ${timeoutMs}ms: ${url}`);
        this.name = 'FetchTimeoutError';
    }
}

export async function fetchWithTimeout(
    url: string,
    init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
    const { timeoutMs = FETCH_TIMEOUT_MS, signal, ...rest } = init ?? {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
        return await fetch(url, { ...rest, signal: controller.signal });
    } catch (error) {
        // 外側 signal が中断していないのに AbortError = タイムアウト発火
        if (
            error instanceof DOMException &&
            error.name === 'AbortError' &&
            !signal?.aborted
        ) {
            throw new FetchTimeoutError(url, timeoutMs);
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
    }
}
