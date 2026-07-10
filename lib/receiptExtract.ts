import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, INVOICE_EXTRACT_MODEL } from '@/lib/anthropic';

export interface ExtractedReceipt {
    storeName: string | null;
    issueDate: string | null; // YYYY-MM-DD
    totalAmount: number | null; // 税込合計
    taxAmount: number | null;
    summary: string | null; // 摘要（ガソリン代 / 飲食 等の一言）
    suggestedCategory: string | null; // 渡した費目名のいずれか or null
    currency: string | null; // 通貨コード（detectCurrency 時のみ・円は null）。例 'USD'
}

export interface ExtractReceiptsOptions {
    /// true にすると外貨レシート（ドル建てのサブスク請求書等）の通貨コードを判定させ、
    /// 金額をその通貨の値のまま抽出する（クレジットカード受け箱用。既定 false=従来どおり円前提）
    detectCurrency?: boolean;
}

// 費目名の一覧を渡して suggestedCategory を enum で制約したツールスキーマを作る。
// 費目が1件も無い場合は enum を付けない（enum: [] は API エラーになるため）。
const buildInputSchema = (categoryNames: string[], detectCurrency: boolean) => {
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
            receipts: {
                type: 'array',
                description: '画像・PDFに写っている領収書・レシート（1枚ごとに1要素）。1枚だけなら1要素。',
                items: {
                    type: 'object',
                    properties: {
                        storeName: { type: 'string', description: '店名・支払先。例: セブンイレブン◯◯店、ENEOS、◯◯金物店。不明なら空文字' },
                        issueDate: { type: 'string', description: '領収書・レシートの日付。YYYY-MM-DD 形式。和暦（令和等）は西暦に変換。不明なら空文字' },
                        totalAmount: {
                            type: 'number',
                            description: detectCurrency ? '税込の支払合計。その通貨の値のまま（例 $29.39 → 29.39）。数値のみ' : '税込の支払合計（円）。数値のみ',
                        },
                        taxAmount: { type: 'number', description: detectCurrency ? '税額。totalAmount と同じ通貨の値。不明なら 0' : '消費税額（円）。内税表記の「うち消費税」も可。不明なら 0' },
                        summary: { type: 'string', description: '内容の摘要を一言で。例: ガソリン代 / 駐車場代 / 資材購入 / 飲食。不明なら空文字' },
                        suggestedCategory: suggested,
                        ...(detectCurrency
                            ? { currency: { type: 'string', description: '金額の通貨コード。日本円なら空文字、外貨は USD 等のISOコード' } }
                            : {}),
                    },
                    required: ['storeName', 'totalAmount'],
                },
            },
        },
        required: ['receipts'],
    };
};

const buildPrompt = (categoryNames: string[], detectCurrency: boolean) => {
    const categoryLine =
        categoryNames.length > 0
            ? `- 費目(suggestedCategory)は各領収書ごとに、次の一覧から最も近いものを1つ選んでください。どれにも当てはまらない場合は空文字にしてください。\n  費目一覧: ${categoryNames.join(' / ')}`
            : '- 費目(suggestedCategory)は各領収書ごとに内容から最も近い分類語を推定してください。不明なら空文字。';
    const currencyLine = detectCurrency
        ? '\n- 外貨（ドル等）のレシート・請求書は、金額をその通貨の値のまま（$29.39 なら 29.39）入れ、currency に USD 等のISO通貨コードを入れてください。日本円なら currency は空文字。'
        : '';
    return `あなたは建設・足場会社の経理担当アシスタントです。添付された画像またはPDFには「領収書・レシート」が1枚以上写っています。写っている領収書を1枚ずつ読み取り、receipts 配列に1件ずつ入れて record_receipts ツールで記録してください。

- 1枚だけなら1件だけ。複数枚が写っていれば、それぞれを別々の要素にしてください（束ねない）。
- 金額は数値のみ（カンマ・「円」・「¥」を除く）。税込の支払合計を totalAmount に入れてください。
- 日付は YYYY-MM-DD 形式。和暦（令和等）は西暦に変換してください。${currencyLine}
${categoryLine}
- 内容がわかる短い摘要を summary に入れてください（例: ガソリン代、駐車場代、資材購入）。
- 読み取れない項目は空文字または 0 にし、推測で埋めないでください。`;
};

// 通貨コードの正規化。円・空は null（円扱い）、それ以外は大文字のISOコード。
export const normalizeCurrency = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return t === '' || t === 'JPY' || t === '円' ? null : t;
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
 * 領収書・レシート（PDF or 画像）の base64 を Claude(Sonnet 4.6) で読み取り、
 * 画像内の領収書を1枚ずつ構造化して配列で返す（1枚の写真に複数枚あれば複数件）。
 * tool_choice でツール使用を強制し、確実に JSON を得る。
 * categoryNames にアクティブな費目名を渡すと suggestedCategory を enum で制約する。
 * 読み取れる領収書が無ければ空配列を返す（呼び出し側で手入力用の空レコードを作る）。
 */
export async function extractReceipts(
    base64: string,
    mimeType: string,
    categoryNames: string[] = [],
    opts: ExtractReceiptsOptions = {},
): Promise<ExtractedReceipt[]> {
    const detectCurrency = opts.detectCurrency === true;
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
        max_tokens: 4000,
        tools: [
            {
                name: 'record_receipts',
                description: '領収書・レシートから抽出した情報を記録する（複数枚可）',
                input_schema: buildInputSchema(categoryNames, detectCurrency) as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: 'record_receipts' },
        messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: buildPrompt(categoryNames, detectCurrency) }] }],
    });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('領収書の読み取りに失敗しました');
    }
    const raw = toolUse.input as Record<string, unknown>;
    const list = Array.isArray(raw.receipts) ? (raw.receipts as Record<string, unknown>[]) : [];

    return list
        .map((r) => ({
            storeName: str(r.storeName),
            issueDate: str(r.issueDate),
            totalAmount: num(r.totalAmount),
            taxAmount: num(r.taxAmount),
            summary: str(r.summary),
            suggestedCategory: str(r.suggestedCategory),
            currency: detectCurrency ? normalizeCurrency(r.currency) : null,
        }))
        .filter((r) => r.storeName || r.totalAmount != null); // 中身のある領収書だけ
}
