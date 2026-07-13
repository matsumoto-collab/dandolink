import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, INVOICE_EXTRACT_MODEL } from '@/lib/anthropic';

// 支払請求書（他社からの請求書）のAI抽出結果。
// 旧・仕入請求書取込(94d02aa で撤去)の抽出を土台に、明細行・費目・案件ヒントを外し、
// インボイス登録番号を追加した軽量版。原価計算には使わない（支払予定への取込専用）。
export interface ExtractedSupplierInvoice {
    payeeName: string | null;
    payeeKana: string | null;
    bankName: string | null;
    branchName: string | null;
    accountType: string | null; // '普通' | '当座'
    accountNumber: string | null;
    accountHolder: string | null;
    issueDate: string | null; // YYYY-MM-DD
    dueDate: string | null; // YYYY-MM-DD
    totalAmount: number | null; // 税込合計
    taxAmount: number | null;
    registrationNumber: string | null; // インボイス登録番号（T+13桁）
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
        registrationNumber: { type: 'string', description: '適格請求書発行事業者の登録番号（T＋数字13桁。例: T1234567890123）。記載が無ければ空文字' },
    },
    required: ['payeeName', 'totalAmount'],
};

const PROMPT = `あなたは建設・足場業の経理担当アシスタントです。添付された「取引先からの請求書（こちらが支払う側の請求書）」の画像またはPDFを読み取り、record_supplier_invoice ツールで構造化して記録してください。

- 金額は数値のみ（カンマ・「円」・「¥」を除く）。
- 税込の最終的な請求合計を totalAmount に入れてください（小計＋消費税の合計）。
- 日付は YYYY-MM-DD 形式。和暦（令和等）は西暦に変換してください。
- 請求書の「振込先」「お振込先」欄に銀行口座があれば bankName/branchName/accountType/accountNumber/accountHolder と、支払先のフリガナを payeeKana に入れてください。口座種別は「普通」か「当座」。記載が無ければ空文字。
- 適格請求書発行事業者の登録番号（「登録番号」「インボイス番号」等。T＋13桁の数字）があれば registrationNumber に入れてください。
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
// インボイス登録番号は「T＋数字13桁」に正規化。ハイフン・空白・全角を吸収し、形式外は null（推測で埋めない）
export const normalizeRegistrationNumber = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.normalize('NFKC').replace(/[^0-9a-zA-Z]/g, '').toUpperCase() : '';
    return /^T\d{13}$/.test(t) ? t : null;
};

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * 請求書（PDF or 画像）の base64 を Claude で読み取り、構造化データを返す。
 * tool_choice でツール使用を強制し、確実に JSON を得る（lib/receiptExtract.ts と同方式）。
 */
export async function extractSupplierInvoice(base64: string, mimeType: string): Promise<ExtractedSupplierInvoice> {
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
                name: 'record_supplier_invoice',
                description: '請求書から抽出した情報を記録する',
                input_schema: INPUT_SCHEMA as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: 'record_supplier_invoice' },
        messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
    });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('請求書の読み取りに失敗しました');
    }
    const raw = toolUse.input as Record<string, unknown>;

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
        registrationNumber: normalizeRegistrationNumber(raw.registrationNumber),
    };
}
