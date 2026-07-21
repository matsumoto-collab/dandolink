import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, errorResponse, serverErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { askScheduleAssistant } from '@/lib/availabilityAssistant';

export const maxDuration = 60;

/**
 * POST /api/ai/availability - スケジュールAI照会（班別空き状況・仮予定・浮き）
 *
 * 中身（システムプロンプト・ツール定義・実行ループ）は lib/availabilityAssistant.ts。
 * ここでは認証・権限・レート制限・入力検証のみを行う。
 */

const MAX_HISTORY = 10;

export async function POST(req: NextRequest) {
    const rateLimitError = await applyRateLimit(req, RATE_LIMITS.heavy);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        // kei指示（2026-07-18）: AI照会は管理者・マネージャーのみ
        if (!isManagerOrAbove(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question) return errorResponse('質問を入力してください', 400);
        if (question.length > 500) return errorResponse('質問が長すぎます（500文字以内）', 400);

        // 直近の会話履歴（続き質問「じゃあ翌日は？」対応）。表示テキストのみ・最大10件
        const history: Anthropic.MessageParam[] = Array.isArray(body.history)
            ? (body.history as Array<{ role?: string; content?: string }>)
                  .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
                  .slice(-MAX_HISTORY)
                  .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 2000) }))
            : [];

        // userId は浮きメモ追記の updatedBy に使う（記録指示があったときのみ書き込み）
        const answer =
            (await askScheduleAssistant(question, history, session!.user.id)) ||
            'すみません、うまく回答できませんでした。もう一度言い方を変えて聞いてください。';

        return NextResponse.json({ answer });
    } catch (error) {
        return serverErrorResponse('AI照会', error);
    }
}
