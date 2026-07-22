import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, SCHEDULE_AI_MODEL } from '@/lib/anthropic';
import { getCrewAvailability, getCrewAvailabilitySummaryRange, getFloating } from '@/lib/crewAvailability';
import { getFloatingMemo, appendFloatingMemo } from '@/lib/floatingMemo';
import { findNearbyJobs } from '@/lib/nearbyJobs';
import { logger } from '@/lib/logger';

/**
 * スケジュールAI照会の中身（システムプロンプト・ツール定義・ツール実行ループ）。
 *
 * 「数字はDB・言葉はAI」: 空き時間・調整候補・浮きの数字は lib/crewAvailability.ts が
 * 計算し、AIは日付の解釈と短い文章化のみを行う（ツール使用の強制で担保）。
 * API ルート（app/api/ai/availability/route.ts）から認証・検証済みの入力で呼ばれる。
 * ルートから分離してあるのは、実データ＋実モデルでの挙動検証をスクリプトから
 * 直接行えるようにするため（scripts/verify-ai-assistant.ts）。
 *
 * 【班の表示について】
 * 2026-07-18〜07-20 の一時期、一部の班（玉ノ井・修栄工業・開成工業・阿部工業・
 * マドプラス・今井・三生・松本）を空き班の列挙から外す運用を入れていたが、
 * 「載せる／載せない」の線引きが事故を招いた（プロンプトに班名を書いた際、AIが
 * 同名の案件担当者まで対象と誤解し、浮いている現場そのものを握り潰した）ため、
 * kei判断で 07-20 に撤廃。**現在は全ての班を通常どおり回答に含める。**
 * 同種の要望が再度出た場合、プロンプトに名前を列挙する方式は採らないこと。
 */

const MAX_TOOL_ROUNDS = 5;

const TOOLS: Anthropic.Tool[] = [
    {
        name: 'get_crew_availability',
        description:
            '指定日1日の詳細を取得する。summary（総メンバー数・使用人数・休暇・残り人数=余っている人数・仮予定の件数=tentativeJobCount）、各班の予定（現場名・時間・人数・確定/仮・確認予定日・担当者）、仮予定が動けば浮かせられる人数（negotiableMembers）、その日の浮き（班未定の仕事）を返す。',
        input_schema: {
            type: 'object' as const,
            properties: {
                date: { type: 'string', description: '対象日 YYYY-MM-DD（JST）' },
            },
            required: ['date'],
        },
    },
    {
        name: 'get_crew_availability_summary_range',
        description:
            '期間内の日ごとの人数サマリを取得する。各日の totalMembers（総メンバー数）・usedMembers（配置済み）・vacationMembers（休暇）・remainingMembers（余っている人数）・negotiableMembers・tentativeJobCount（仮予定の件数）・浮き件数を返す。「余っている人数」「残り人数」「空いている人数」「直近の空き」など人数の質問はまずこれを使う（最大14日）。',
        input_schema: {
            type: 'object' as const,
            properties: {
                startDate: { type: 'string', description: '開始日 YYYY-MM-DD（省略時=今日）' },
                endDate: { type: 'string', description: '終了日 YYYY-MM-DD（省略時=開始日から7日間）' },
            },
            required: [],
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
    {
        name: 'find_nearby_jobs',
        description:
            '指定した地名の「近く」で予定が入っている現場を、近い順に取得する（現調でまとめて回るための照会）。各現場の distanceKm（基準点からの直線距離）・日付・班名（team=null は浮き＝班未定）・住所・人数・確定/仮・担当者を返す。resolved が null のときはその地名の場所を特定できていない。unknownLocation は住所（座標）が未登録で距離を判定できなかった案件。jobs の outsideRadius=true は半径内に1件も無かったときの「一番近い現場」。',
        input_schema: {
            type: 'object' as const,
            properties: {
                place: { type: 'string', description: '地名（質問文から抜き出す。例「北条」「新居浜」「松山市南吉田町」）' },
                startDate: { type: 'string', description: '開始日 YYYY-MM-DD（省略時=今日）' },
                endDate: { type: 'string', description: '終了日 YYYY-MM-DD（省略時=開始日から7日間・最大31日）' },
                radiusKm: { type: 'number', description: '半径km（省略時=10・最大50）。質問で「◯km以内」と指定されたときだけ渡す' },
            },
            required: ['place'],
        },
    },
    {
        name: 'get_floating_memo',
        description:
            '指定日の「浮きレーンのメモ」の現在値を取得する（週間カレンダー最下部の浮きレーンに人が手で書くのと同じメモ）。追記の前に現在値を確認したいときに使う。',
        input_schema: {
            type: 'object' as const,
            properties: {
                date: { type: 'string', description: '対象日 YYYY-MM-DD（JST）' },
            },
            required: ['date'],
        },
    },
    {
        name: 'append_floating_memo',
        description:
            '指定日の「浮きレーンのメモ」に text を追記する（既存メモは消さず改行で連結）。ユーザーが「メモして」「浮きに残して」等、明確に記録を指示したときだけ使う。書けるのはこの浮きメモだけで、予定・案件・班へは一切書き込めない。500文字を超えて入りきらない場合は追記せず tooLong を返す。',
        input_schema: {
            type: 'object' as const,
            properties: {
                date: { type: 'string', description: '対象日 YYYY-MM-DD（JST）' },
                text: { type: 'string', description: 'メモに追記する内容（素のテキスト。出所印は付けない）' },
            },
            required: ['date', 'text'],
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
- 「余っている人数」「残り人数」「空いている人数」= remainingMembers（総メンバー数 − 配置で使っている人数 − 休暇の人数）。人数の質問には必ずツールの remainingMembers を使い、自分で計算しない。マイナスの場合は「入れすぎ（人手不足）」。
- 「直近」「ここ最近」= 今日から7日間と解釈して get_crew_availability_summary_range を呼ぶ（確認の聞き返しは不要）。
- 「仮予定」= 先方未確定のまま経験則で仮押さえした予定（dateStatus=tentative）。動かせる可能性があるが、動かすには先方への確認が必要な場合がある。
- 「浮いている／浮き」= 班が決まっていない仕事（未充足の需要）。dateStatus=tentative の浮きは日付自体も仮。
- 「浮いている現場はある？」「今浮いているのは？」のような期間指定のない浮きの質問は、get_floating を startDate/endDate 省略（=今日から30日間）で呼び、返ってきた全件を答える。
- 「◯◯（地名）の近く」「◯◯周辺」「◯◯のあたり」= find_nearby_jobs で地名の周辺の予定を探す（既定は半径10km・現調で寄れる範囲）。「◯km以内」と指定されたときだけ radiusKm を渡す。期間の指定がなければ今日から7日間。
- negotiableMembers = 仮予定が動けば浮かせられる「人数」。tentativeJobCount = 仮予定の「件数」。人数0の仮予定もあるため、negotiableMembers が0でも仮予定が存在することがある。「仮予定なし」と言ってよいのは tentativeJobCount が0のときだけで、negotiableMembers が0でも仮予定が1件でもあるなら「仮予定は◯件あるが、動かしても浮かせられる人数は0」と正確に言う。

人数サマリの答え方の例（1日1行・remainingMembers を主役に）:
「・7/22(水): 残り3人（20人中、配置15人・休暇2人）」
残りが0以下の日は「満員」「◯人超過」と言う。日ごとの差が分かるよう並べて示す。

厳守するルール:
1. 数字（空き時間・人数・件数）は必ずツールの結果をそのまま使う。自分で計算・推測・補完しない。データにない日付や班について答えない。
1-2. 数字を含む回答をするときは、その回答の直前に必ず該当ツールを呼び、返ってきた結果の数字だけを使う。**会話履歴に自分が以前書いた数字を信用・再利用してはならない**（会話中もデータは変わる）。ユーザーに数字の誤りを指摘されたら、弁明せず黙ってツールを呼び直し、最新の結果だけで答え直す。ツールを呼んでいないのに「確認しました」と言うことは絶対に禁止。
2. 「空けられます」と断言しない。仮予定を動かせるかはあなたには判断できない（先方への一報が必要な場合がある）。言えるのは「調整候補」と「聞くべき相手」まで。仮予定を候補として挙げるときは必ず「調整できるかは◯◯さんに確認してください」と担当者名を添える。
3. 人数（memberCount）と時間（hours）を混ぜて言わない。空き枠のマッチングは人数ベースで答え、時間は「（参考: 予定◯時間）」程度の補足にとどめる。
4. dateStatus=tentative の浮きは、日付に必ず「(日付も仮)」を付けて、確定日と誤読させない。
5. 結論から先に、短く。運転中に聞かれる前提。1班1行程度の箇条書きが望ましい。
6. 担当者は owners の先頭（主担当）を「◯◯さん」と呼ぶ。複数いる場合は「◯◯さん＋他N名」。
7. 日付が読み取れない・曖昧すぎる場合は、推測せず「何日のことか」を短く聞き返す。
8. スケジュール以外の話題（雑談・会社と無関係な質問）には「スケジュールの確認のみ対応しています」と短く答える。
9. 出力はプレーンテキストのみ。Markdown記法（* や ** や # や \` など）は絶対に使わない。強調も記号で飾らず言葉で表現する。箇条書きの行頭は「・」を使う。音声で読み上げられることがあるため、記号の少ない読みやすい文にする。
10. ツールが返したものは隠さない。班・浮いている現場・仮予定・案件は、班名や担当者名が何であれ、全て通常どおり回答に含める。「報告対象外」「対象ではない」と自己判断して省略することは、どんな理由でも禁止。質問に対して件数が多すぎる場合だけ、件数を明示したうえで主要なものに絞る（例:「全部で12件、うち近い5件は…」）。

近くの現場を探すとき（現調でまとめて回るための照会）:
11. 距離は必ず find_nearby_jobs の distanceKm を「約◯km」と言う。地図の知識で距離や位置関係を推測してはいけない。jobs は現場ごとにまとまっていて schedule にその現場の予定日が入っているので、1現場1行で「・約2km 松山市北条辻 山田様邸 7/24(金)・7/25(土) 玉ノ井班」のように、距離・住所・現場名・日付・班名を並べる。schedule の team が null の日は班名の代わりに「浮き（班未定）」、dateStatus が tentative の日は日付に「(仮)」を付ける。近い順に並んでいる順番を変えない。
12. unknownLocation.count が1件以上なら、回答の最後に必ず「住所が未登録の案件が◯件あり、この中に近い現場が含まれている可能性があります」と添える。近い現場が見つかったときも省略しない。totalInRadius が jobs の件数より多いときは「半径◯km以内は全部で◯件、近い順に◯件を挙げます」と件数を明示する。
13. resolved が null のときは、場所を推測せず「◯◯がどのあたりか分かりませんでした。市区町村名を付けて聞いてください」と答える。jobs の outsideRadius が true のときは「半径◯km以内には予定がありません。一番近いのは約◯km先の…」と、半径外であることを必ず言う。

浮きレーンのメモへの書き込みについて（あなたが書けるのはこのメモだけ）:
14. あなたが書き込めるのは浮きレーンのメモ欄だけです。予定・案件・確定枠・班の予定は一切変更・登録・削除できません（従来どおり）。求められても「メモには残せますが、予定の登録・変更はできません」と伝える。
15. append_floating_memo を呼ぶのは、ユーザーが「メモして」「書いといて」「浮きに残して」など、明確に記録を指示したときだけ。空き状況や浮きを聞かれただけで勝手に書いてはいけない。
16. 依頼があいまいで、書く日付や内容が特定できないときは、書かずに「◯月◯日の浮きメモに『…』と書きますか？」と一度だけ短く確認する。
17. 書く前に必要なら get_floating_memo でその日の現在値を確認する。既存のメモは消さず追記する（append 関数が追記するので、あなたは上書きのつもりで呼んではいけない）。
18. 書いたら必ず「◯月◯日の浮きメモに『…』と追記しました。取り消すにはスケジュールの浮きレーンのメモから削除してください」と報告する。
19. append_floating_memo が「500文字の上限で入りきらない（tooLong）」と返したら、その旨を伝えて追記しない。`;
}

/**
 * ツール実行の文脈。
 * - userId: 浮きメモ追記の updatedBy
 * - memoDates: 実際に書き込んだ日付（呼び出し側へ返し、画面のメモを即時再取得させる）
 */
interface ToolContext {
    userId?: string;
    memoDates: string[];
}

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (name === 'get_crew_availability') {
        const date = String(input.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date は YYYY-MM-DD 形式で指定してください' });
        return JSON.stringify(await getCrewAvailability(date));
    }
    if (name === 'get_crew_availability_summary_range') {
        const startDate = input.startDate ? String(input.startDate) : undefined;
        const endDate = input.endDate ? String(input.endDate) : undefined;
        if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return JSON.stringify({ error: 'startDate は YYYY-MM-DD 形式で指定してください' });
        if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return JSON.stringify({ error: 'endDate は YYYY-MM-DD 形式で指定してください' });
        return JSON.stringify(await getCrewAvailabilitySummaryRange(startDate, endDate));
    }
    if (name === 'get_floating') {
        const startDate = input.startDate ? String(input.startDate) : undefined;
        const endDate = input.endDate ? String(input.endDate) : undefined;
        return JSON.stringify(await getFloating(startDate, endDate));
    }
    if (name === 'find_nearby_jobs') {
        const place = typeof input.place === 'string' ? input.place : '';
        if (!place.trim()) return JSON.stringify({ error: 'place（地名）を指定してください' });
        const startDate = input.startDate ? String(input.startDate) : undefined;
        const endDate = input.endDate ? String(input.endDate) : undefined;
        if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return JSON.stringify({ error: 'startDate は YYYY-MM-DD 形式で指定してください' });
        if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return JSON.stringify({ error: 'endDate は YYYY-MM-DD 形式で指定してください' });
        const radiusKm = typeof input.radiusKm === 'number' ? input.radiusKm : undefined;
        return JSON.stringify(await findNearbyJobs({ place, startDate, endDate, radiusKm }));
    }
    if (name === 'get_floating_memo') {
        const date = String(input.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date は YYYY-MM-DD 形式で指定してください' });
        return JSON.stringify({ dateKey: date, text: await getFloatingMemo(date) });
    }
    if (name === 'append_floating_memo') {
        const date = String(input.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: 'date は YYYY-MM-DD 形式で指定してください' });
        const text = typeof input.text === 'string' ? input.text : '';
        if (!text.trim()) return JSON.stringify({ error: 'text（メモに書く内容）が空です' });
        const result = await appendFloatingMemo(date, text, ctx.userId);
        if (result.tooLong) {
            // 丸めずに「入りきらない」と返す＝AIはこの旨を伝えて追記しない
            return JSON.stringify({ ok: false, tooLong: true, message: '浮きメモが500文字の上限に達するため追記できませんでした', currentText: result.text });
        }
        if (!ctx.memoDates.includes(result.dateKey)) ctx.memoDates.push(result.dateKey);
        return JSON.stringify({ ok: true, dateKey: result.dateKey, text: result.text });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
}

export interface ScheduleAssistantResult {
    /** 最終回答テキスト。得られなかった場合は空文字列（呼び出し側でフォールバック文言にする） */
    answer: string;
    /** この照会で浮きメモを書き込んだ日付（YYYY-MM-DD）。画面側はこれを見て即時再取得する */
    memoDates: string[];
}

/**
 * 質問＋会話履歴を受け取り、ツール実行ループを回して最終回答を返す。
 * userId は浮きメモ追記（append_floating_memo）の updatedBy として渡す（無くても動く）。
 */
export async function askScheduleAssistant(
    question: string,
    history: Anthropic.MessageParam[],
    userId?: string
): Promise<ScheduleAssistantResult> {
    const client = getAnthropic();
    const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: question }];
    const system = buildSystemPrompt();
    const ctx: ToolContext = { userId, memoDates: [] };

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
                content = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx);
            } catch (e) {
                logger.error(`[availabilityAssistant] ツール実行に失敗: ${tu.name}`, e);
                content = JSON.stringify({ error: 'データの取得に失敗しました' });
            }
            results.push({ type: 'tool_result', tool_use_id: tu.id, content });
        }
        messages.push({ role: 'user', content: results });
    }

    return { answer, memoDates: ctx.memoDates };
}
