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

// スケジュールAI照会（班別空き・浮き）に使うモデル。
// 当初は Haiku だったが、ツールの正しい数字を無視して会話中の数字から回答を
// 捏造する事故があり（2026-07-20 kei報告: 残り0人の日を「残り3人」と回答）、
// 数字の転記精度と自己訂正の頑健性を優先して Sonnet に引き上げた。
// 2026-07-20: 精度不足のkei報告により sonnet-4-6 → 最新世代 sonnet-5 へ変更。
export const SCHEDULE_AI_MODEL = 'claude-sonnet-5';
