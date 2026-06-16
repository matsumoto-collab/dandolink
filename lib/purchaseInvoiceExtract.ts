import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, INVOICE_EXTRACT_MODEL } from '@/lib/anthropic';

export interface ExtractedInvoiceItem {
    name: string;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | null;
    amount: number | null;
}

export interface ExtractedInvoice {
    payeeName: string | null;
    payeeKana: string | null;
    bankName: string | null;
    branchName: string | null;
    accountType: string | null;
    accountNumber: string | null;
    accountHolder: string | null;
    issueDate: string | null; // YYYY-MM-DD
    dueDate: string | null; // YYYY-MM-DD
    totalAmount: number | null; // 税込合計
    taxAmount: number | null;
    suggestedCategory: string | null; // 費目の推定語（材料費 / リース費 等）
    projectHint: string | null; // 現場名・案件名のヒント
    items: ExtractedInvoiceItem[];
}

const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        payeeName: { type: 'string', description: '請求元（支払先）の会社名・屋号。例: 株式会社山田建材' },
        payeeKana: { type: 'string', description: '支払先のフリガナ（カタカナ）。不明なら空文字' },
        bankName: { type: 'string', description: '振込先の銀行名。例: 愛媛銀行。請求書下部の振込先欄から。不明なら空文字' },
        branchName: { type: 'string', description: '振込先の支店名。例: 本店、見奈良支店。不明なら空文字' },
        accountType: { type: 'string', description: '口座種別。「普通」または「当座」のいずれか。不明なら空文字' },
        accountNumber: { type: 'string', description: '口座番号（数字）。不明なら空文字' },
        accountHolder: { type: 'string', description: '口座名義（カナ可）。不明なら空文字' },
        issueDate: { type: 'string', description: '請求書の発行日。YYYY-MM-DD 形式。和暦は西暦に変換。不明なら空文字' },
        dueDate: { type: 'string', description: 'お支払い期限・振込期日。YYYY-MM-DD 形式。不明なら空文字' },
        totalAmount: { type: 'number', description: '税込の請求金額合計（円）。最終的な合計請求額' },
        taxAmount: { type: 'number', description: '消費税額（円）。不明なら 0' },
        suggestedCategory: { type: 'string', description: '費目の推定。材料費 / リース費 / 燃料費 / 重機リース などの分類語。不明なら空文字' },
        projectHint: { type: 'string', description: '請求書に書かれた現場名・案件名・工事名・宛先物件があれば。なければ空文字' },
        items: {
            type: 'array',
            description: '明細行',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '品名・項目名' },
                    quantity: { type: 'number', description: '数量。不明なら 0' },
                    unit: { type: 'string', description: '単位。不明なら空文字' },
                    unitPrice: { type: 'number', description: '単価（円）。不明なら 0' },
                    amount: { type: 'number', description: '金額（円）' },
                },
                required: ['name'],
            },
        },
    },
    required: ['payeeName', 'totalAmount', 'items'],
};

const PROMPT = `あなたは建設・足場業の経理担当アシスタントです。添付された「仕入先からの請求書（こちらが支払う側の請求書）」の画像またはPDFを読み取り、record_invoice ツールで構造化して記録してください。

- 金額は数値のみ（カンマ・「円」・「¥」を除く）。
- 税込の最終的な請求合計を totalAmount に入れてください（小計＋消費税の合計）。
- 日付は YYYY-MM-DD 形式。和暦（令和等）は西暦に変換してください。
- 費目(suggestedCategory)は、材料費・リース費・燃料費・重機リースなど、内容から最も近い分類語を推定してください。
- 現場名・工事名・物件名の記載があれば projectHint に入れてください。
- 請求書の「振込先」「お振込先」欄に銀行口座があれば bankName/branchName/accountType/accountNumber/accountHolder と、支払先のフリガナを payeeKana に入れてください。口座種別は「普通」か「当座」。記載が無ければ空文字。
- 読み取れない項目は空文字または 0 にし、推測で埋めないでください。`;

const str = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t === '' ? null : t;
};
const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,，円¥\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
};
// 口座種別は Payee の制約に合わせ '普通'|'当座' のみ採用（それ以外は null）
const normalizeAccountType = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.includes('当座')) return '当座';
    if (t.includes('普通')) return '普通';
    return null;
};

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * 請求書（PDF or 画像）の base64 を Claude(Sonnet 4.6) で読み取り、構造化データを返す。
 * tool_choice でツール使用を強制し、確実に JSON を得る（thinking は使わない）。
 */
export async function extractPurchaseInvoice(base64: string, mimeType: string): Promise<ExtractedInvoice> {
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
                name: 'record_invoice',
                description: '請求書から抽出した情報を記録する',
                input_schema: INPUT_SCHEMA as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: 'record_invoice' },
        messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
    });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('請求書の読み取りに失敗しました');
    }
    const raw = toolUse.input as Record<string, unknown>;

    const items: ExtractedInvoiceItem[] = Array.isArray(raw.items)
        ? (raw.items as Record<string, unknown>[])
              .map((it) => ({
                  name: str(it.name) ?? '',
                  quantity: num(it.quantity),
                  unit: str(it.unit),
                  unitPrice: num(it.unitPrice),
                  amount: num(it.amount),
              }))
              .filter((it) => it.name)
        : [];

    return {
        payeeName: str(raw.payeeName),
        payeeKana: str(raw.payeeKana),
        bankName: str(raw.bankName),
        branchName: str(raw.branchName),
        accountType: normalizeAccountType(raw.accountType),
        accountNumber: str(raw.accountNumber),
        accountHolder: str(raw.accountHolder),
        issueDate: str(raw.issueDate),
        dueDate: str(raw.dueDate),
        totalAmount: num(raw.totalAmount),
        taxAmount: num(raw.taxAmount),
        suggestedCategory: str(raw.suggestedCategory),
        projectHint: str(raw.projectHint),
        items,
    };
}
