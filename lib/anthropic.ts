import Anthropic from '@anthropic-ai/sdk';

// Claude API のサーバー専用クライアント。クライアントコンポーネントからは import しないこと。
if (typeof window !== 'undefined') {
    throw new Error('lib/anthropic はサーバーサイドでのみ使用可能です。クライアントコンポーネントからインポートしないでください。');
}

let client: Anthropic | null = null;

/**
 * 遅延初期化。ANTHROPIC_API_KEY 未設定でもモジュール読み込み（ビルド）は壊さず、
 * 実際に呼び出した時点で明示的なエラーにする。
 */
export function getAnthropic(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY が設定されていません（Vercel と .env.local に設定してください）');
    }
    if (!client) client = new Anthropic({ apiKey });
    return client;
}

// 請求書の読み取りに使うモデル（精度とコストのバランス）
export const INVOICE_EXTRACT_MODEL = 'claude-sonnet-4-6';
