import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, INVOICE_EXTRACT_MODEL } from '@/lib/anthropic';

export interface ExtractedReceipt {
    storeName: string | null;
    issueDate: string | null; // YYYY-MM-DD
    totalAmount: number | null; // 税込合計
    taxAmount: number | null;
    summary: string | null; // 摘要（ガソリン代 / 飲食 等の一言）
    suggestedCategory: string | null; // 渡した費目名のいずれか or null
}

// 費目名の一覧を渡して suggestedCategory を enum で制約したツールスキーマを作る。
// 費目が1件も無い場合は enum を付けない（enum: [] は API エラーになるため）。
const buildInputSchema = (categoryNames: string[]) => {
    const suggested: Record<string, unknown> = {
        type: 'string',
        description: '費目の推定。下記の費目一覧から最も近いものを1つ。該当が無ければ空文字',
    };
    if (categoryNames.length > 0) {
        suggested.enum = [...categoryNames, ''];
    }
    return {
        type: 'object',
        properties: {
            storeName: { type: 'string', description: '店名・支払先。例: セブンイレブン◯◯店、ENEOS、◯◯金物店。不明なら空文字' },
            issueDate: { type: 'string', description: '領収書・レシートの日付。YYYY-MM-DD 形式。和暦（令和等）は西暦に変換。不明なら空文字' },
            totalAmount: { type: 'number', description: '税込の支払合計（円）。数値のみ' },
            taxAmount: { type: 'number', description: '消費税額（円）。内税表記の「うち消費税」も可。不明なら 0' },
            summary: { type: 'string', description: '内容の摘要を一言で。例: ガソリン代 / 駐車場代 / 資材購入 / 飲食。不明なら空文字' },
            suggestedCategory: suggested,
        },
        required: ['storeName', 'totalAmount'],
    };
};

const buildPrompt = (categoryNames: string[]) => {
    const categoryLine =
        categoryNames.length > 0
            ? `- 費目(suggestedCategory)は次の一覧から最も近いものを1つ選んでください。どれにも当てはまらない場合は空文字にしてください。\n  費目一覧: ${categoryNames.join(' / ')}`
            : '- 費目(suggestedCategory)は内容から最も近い分類語を推定してください。不明なら空文字。';
    return `あなたは建設・足場会社の経理担当アシスタントです。添付された「領収書・レシート」の画像またはPDFを読み取り、record_receipt ツールで構造化して記録してください。

- 金額は数値のみ（カンマ・「円」・「¥」を除く）。
- 税込の支払合計を totalAmount に入れてください。
- 日付は YYYY-MM-DD 形式。和暦（令和等）は西暦に変換してください。
${categoryLine}
- 内容がわかる短い摘要を summary に入れてください（例: ガソリン代、駐車場代、資材購入）。
- 読み取れない項目は空文字または 0 にし、推測で埋めないでください。`;
};

const str = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t === '' ? null : t;
};
const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,，円¥\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
};

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * 領収書・レシート（PDF or 画像）の base64 を Claude(Sonnet 4.6) で読み取り、構造化データを返す。
 * tool_choice でツール使用を強制し、確実に JSON を得る。
 * categoryNames にアクティブな費目名を渡すと suggestedCategory を enum で制約する。
 */
export async function extractReceipt(base64: string, mimeType: string, categoryNames: string[] = []): Promise<ExtractedReceipt> {
    const client = getAnthropic();
    const isPdf = mimeType === 'application/pdf';
    const imageMediaType: ImageMediaType = IMAGE_MEDIA_TYPES.includes(mimeType as ImageMediaType)
        ? (mimeType as ImageMediaType)
        : 'image/jpeg';

    const sourceBlock: Anthropic.ContentBlockParam = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: base64 } };

    const res = await client.messages.create({
        model: INVOICE_EXTRACT_MODEL,
        max_tokens: 2000,
        tools: [
            {
                name: 'record_receipt',
                description: '領収書・レシートから抽出した情報を記録する',
                input_schema: buildInputSchema(categoryNames) as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: 'record_receipt' },
        messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: buildPrompt(categoryNames) }] }],
    });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('領収書の読み取りに失敗しました');
    }
    const raw = toolUse.input as Record<string, unknown>;

    return {
        storeName: str(raw.storeName),
        issueDate: str(raw.issueDate),
        totalAmount: num(raw.totalAmount),
        taxAmount: num(raw.taxAmount),
        summary: str(raw.summary),
        suggestedCategory: str(raw.suggestedCategory),
    };
}
