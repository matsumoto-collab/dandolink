import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, errorResponse, serverErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { getAnthropic, SCHEDULE_AI_MODEL } from '@/lib/anthropic';
import { getCrewAvailability, getFloating } from '@/lib/crewAvailability';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

/**
 * POST /api/ai/availability - スケジュールAI照会（班別空き状況・仮予定・浮き）
 *
 * 「数字はDB・言葉はAI」: 空き時間・調整候補・浮きの数字は lib/crewAvailability.ts が
 * 計算し、Claude（Haiku）は日付の解釈と短い文章化のみを行う（ツール使用の強制で担保）。
 * 権限は社員全員（協力業者 partner/partner_member は除外）。
 */

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 10;

const TOOLS: Anthropic.Tool[] = [
    {
        name: 'get_crew_availability',
        description:
            '指定日の班別空き状況を取得する。各班の予定（現場名・時間・人数・確定/仮・確認予定日・担当者）、空き時間、仮予定が動けば浮かせられる人数（negotiableMembers）、その日の浮き（班未定の仕事）を返す。',
        input_schema: {
            type: 'object' as const,
            properties: {
                date: { type: 'string', description: '対象日 YYYY-MM-DD（JST）' },
            },
            required: ['date'],
        },
    },
    {
        name: 'get_floating',
        description:
            '期間内の「浮いている」現場（班が決まっていない仕事）の一覧を取得する。日付・現場名・必要人数・日付の確度（tentative=日付も仮）・担当者を返す。',
        input_schema: {
            type: 'object' as const,
            properties: {
                startDate: { type: 'string', description: '開始日 YYYY-MM-DD（省略時=今日）' },
                endDate: { type: 'string', description: '終了日 YYYY-MM-DD（省略時=開始日から30日）' },
            },
            required: [],
        },
    },
];

function buildSystemPrompt(): string {
    const now = new Date();
    const jst = new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo',
    }).format(now);
    const isoToday = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
    }).format(now);

    return `あなたは足場工事会社のスケジュール確認アシスタントです。社員からの「◯月◯日に空いている班はあるか」「浮いている現場はあるか」といった質問に、ツールで取得した正確なデータだけを使って答えます。

今日は ${jst}（${isoToday}）です。「明日」「来週の水曜」などの相対的な日付はこれを基準に解釈してください。年の指定がない日付は直近の未来と解釈します。

用語:
- 「仮予定」= 先方未確定のまま経験則で仮押さえした予定（dateStatus=tentative）。動かせる可能性があるが、動かすには先方への確認が必要な場合がある。
- 「浮いている／浮き」= 班が決まっていない仕事（未充足の需要）。dateStatus=tentative の浮きは日付自体も仮。
- negotiableMembers = その班の仮予定が動けば浮かせられる人数。

厳守するルール:
1. 数字（空き時間・人数・件数）は必ずツールの結果をそのまま使う。自分で計算・推測・補完しない。データにない日付や班について答えない。
2. 「空けられます」と断言しない。仮予定を動かせるかはあなたには判断できない（先方への一報が必要な場合がある）。言えるのは「調整候補」と「聞くべき相手」まで。仮予定を候補として挙げるときは必ず「調整できるかは◯◯さんに確認してください」と担当者名を添える。
3. 人数（memberCount）と時間（hours）を混ぜて言わない。空き枠のマッチングは人数ベースで答え、時間は「（参考: 予定◯時間）」程度の補足にとどめる。
4. dateStatus=tentative の浮きは、日付に必ず「(日付も仮)」を付けて、確定日と誤読させない。
5. 結論から先に、短く。運転中に聞かれる前提。1班1行程度の箇条書きが望ましい。
6. 担当者は owners の先頭（主担当）を「◯◯さん」と呼ぶ。複数いる場合は「◯◯さん＋他N名」。
7. 日付が読み取れない・曖昧すぎる場合は、推測せず「何日のことか」を短く聞き返す。
8. スケジュール以外の話題（雑談・会社と無関係な質問）には「スケジュールの確認のみ対応しています」と短く答える。`;
}

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === 'get_crew_availability') {
        const date = String(input.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date は YYYY-MM-DD 形式で指定してください' });
        return JSON.stringify(await getCrewAvailability(date));
    }
    if (name === 'get_floating') {
        const startDate = input.startDate ? String(input.startDate) : undefined;
        const endDate = input.endDate ? String(input.endDate) : undefined;
        return JSON.stringify(await getFloating(startDate, endDate));
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
}

export async function POST(req: NextRequest) {
    const rateLimitError = await applyRateLimit(req, RATE_LIMITS.heavy);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        // 協力業者（partner/partner_member）には社内の空き情報を返さない
        const role = (session!.user.role as string | undefined)?.toLowerCase() ?? '';
        if (role === 'partner' || role === 'partner_member') {
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

        const client = getAnthropic();
        const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: question }];
        const system = buildSystemPrompt();

        let answer = '';
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            const res = await client.messages.create({
                model: SCHEDULE_AI_MODEL,
                max_tokens: 1500,
                system,
                tools: TOOLS,
                messages,
            });

            const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            if (toolUses.length === 0 || round === MAX_TOOL_ROUNDS) {
                answer = res.content
                    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                    .map((b) => b.text)
                    .join('')
                    .trim();
                break;
            }

            messages.push({ role: 'assistant', content: res.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const tu of toolUses) {
                let content: string;
                try {
                    content = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>);
                } catch (e) {
                    logger.error(`[ai/availability] ツール実行に失敗: ${tu.name}`, e);
                    content = JSON.stringify({ error: 'データの取得に失敗しました' });
                }
                results.push({ type: 'tool_result', tool_use_id: tu.id, content });
            }
            messages.push({ role: 'user', content: results });
        }

        if (!answer) {
            answer = 'すみません、うまく回答できませんでした。もう一度言い方を変えて聞いてください。';
        }

        return NextResponse.json({ answer });
    } catch (error) {
        return serverErrorResponse('AI照会', error);
    }
}
