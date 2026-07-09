import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, INVOICE_EXTRACT_MODEL } from '@/lib/anthropic';

export interface ExtractedStatementLine {
    useMonth: number | null; // 利用日の月(1-12)。明細書に年の記載が無いため月日で受ける
    useDay: number | null; // 利用日の日(1-31)
    storeName: string; // 店名。読めなければ ''
    storeCategory: string | null; // 店舗カテゴリ（旅行代理店/専門店 等）
    foreignAmount: number | null; // 海外利用時の外貨金額
    currency: string | null; // 通貨コード（USD 等）
    exchangeRate: number | null; // 換算レート
    amount: number; // 円金額。返金・キャンセルはマイナス。読めなければ 0
    itemDetails: string | null; // 商品明細サブ行を1行にまとめたもの
    suggestedCategory: string | null; // 渡した費目名のいずれか or null
}

export interface ExtractedCardStatement {
    memberName: string | null;
    cardLast4: string | null;
    closingDate: string | null; // 明細書作成日（締め日）YYYY-MM-DD
    totalAmount: number | null; // 「今月ご利用額合計」（検算用）
    lines: ExtractedStatementLine[];
    computedTotal: number; // 抽出した行の amount 合計（マイナス込み・検算用）
}

/**
 * 明細行の「5月15日」形式（年なし）を締め日基準で年補完する。
 * 締め日の年で解釈して締め日より未来になる場合は前年の利用と解釈する
 * （明細書に載る利用日は締め日以前のはずのため）。
 * 例: 締め日 2026-06-18 → 「5月15日」= 2026-05-15、「6月20日」= 2025-06-20。
 * 閏日等の存在しない日付は Date.UTC の繰り上がり（2/30→3/2 等）をそのまま許容する。
 */
export function resolveLineDate(closing: Date, month: number, day: number): Date {
    const y = closing.getUTCFullYear();
    const cand = new Date(Date.UTC(y, month - 1, day));
    return cand.getTime() > closing.getTime() ? new Date(Date.UTC(y - 1, month - 1, day)) : cand;
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
            statement: {
                type: 'object',
                description: '明細書のヘッダ情報',
                properties: {
                    memberName: { type: 'string', description: '会員氏名。不明なら空文字' },
                    cardLast4: { type: 'string', description: 'カード番号（会員番号）の下4桁。不明なら空文字' },
                    closingDate: { type: 'string', description: '明細書作成日（締め日）。YYYY-MM-DD 形式。和暦は西暦に変換。不明なら空文字' },
                    totalAmount: { type: 'number', description: '「今月ご利用額合計」（円・数値のみ）。フッタの合計金額。不明なら 0' },
                },
                required: ['closingDate', 'totalAmount'],
            },
            lines: {
                type: 'array',
                description: '全ページの明細行。合計行・小計行・お支払い方法の案内は含めない',
                items: {
                    type: 'object',
                    properties: {
                        useMonth: { type: 'number', description: '利用日の月(1-12)。「5月15日」なら 5' },
                        useDay: { type: 'number', description: '利用日の日(1-31)。「5月15日」なら 15' },
                        storeName: { type: 'string', description: 'ご利用店名・支払先。不明なら空文字' },
                        storeCategory: { type: 'string', description: '店舗カテゴリ（旅行代理店/専門店/飲食店 等）。無ければ空文字' },
                        foreignAmount: { type: 'number', description: '海外利用時の外貨金額。国内利用は 0' },
                        currency: { type: 'string', description: '通貨（USD、UNITED STATES DOLLAR なら USD 等のコード）。国内利用は空文字' },
                        exchangeRate: { type: 'number', description: '換算レート。国内利用は 0' },
                        amount: { type: 'number', description: 'ご利用金額（円）。数値のみ。返金・キャンセル（△・マイナス表記）はマイナス値' },
                        itemDetails: { type: 'string', description: '商品明細サブ行（数量/金額/商品名）を「商品名 ×数量 ¥金額 / …」の形式で1行にまとめる。無ければ空文字' },
                        suggestedCategory: suggested,
                    },
                    required: ['useMonth', 'useDay', 'storeName', 'amount'],
                },
            },
        },
        required: ['statement', 'lines'],
    };
};

const buildPrompt = (categoryNames: string[]) => {
    const categoryLine =
        categoryNames.length > 0
            ? `- 費目(suggestedCategory)は各明細行ごとに、次の一覧から最も近いものを1つ選んでください。どれにも当てはまらない場合は空文字にしてください。\n  費目一覧: ${categoryNames.join(' / ')}`
            : '- 費目(suggestedCategory)は各明細行ごとに内容から最も近い分類語を推定してください。不明なら空文字。';
    return `あなたは建設・足場会社の経理担当アシスタントです。添付されたPDFまたは画像はクレジットカードの「ご利用代金明細書」（AMEX等）です。ヘッダ情報と明細行を読み取り、record_card_statement ツールで記録してください。

- 複数ページある場合は、全ページの明細行を漏れなく抽出してください。
- 「今月ご利用額合計」「お支払い金額」などの合計行・小計行・お支払い方法や手数料の案内・ポイント案内は lines に含めず、合計金額は statement.totalAmount に入れてください。
- 返金・キャンセル・値引き（△・▲・マイナス表記）の行は amount をマイナス値にしてください。
- 明細行に付属する商品明細のサブ行（数量/金額/商品名）は独立した行にせず、親の明細行の itemDetails に1行でまとめてください。
- 海外利用の行は foreignAmount（外貨金額）・currency（通貨コード）・exchangeRate（換算レート）も抽出してください。国内利用は 0 または空文字。
- 利用日は年の記載が無いため useMonth（月）と useDay（日）の数値で記録してください。
- 金額は数値のみ（カンマ・「円」・「¥」を除く）。
${categoryLine}
- 読み取れない項目は空文字または 0 にし、推測で埋めないでください。`;
};

const str = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t === '' ? null : t;
};
// 符号を保持する数値正規化。△・▲（マイナスの和式表記）も負値として解釈する。
// ※ lib/receiptExtract.ts の num() は n > 0 でマイナスを落とすため返金行には使えない。
const numSigned = (v: unknown): number | null => {
    const n =
        typeof v === 'number'
            ? v
            : Number(
                  String(v ?? '')
                      .replace(/[,，円¥\s]/g, '')
                      .replace(/^[△▲]/, '-')
              );
    return Number.isFinite(n) ? n : null;
};
const posOrNull = (n: number | null): number | null => (n != null && n > 0 ? n : null);
const intInRange = (v: unknown, min: number, max: number): number | null => {
    const n = numSigned(v);
    return n != null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * クレジットカード「ご利用代金明細書」（PDF or 画像）の base64 を Claude で読み取り、
 * ヘッダ（会員名・締め日・合計）と全明細行を構造化して返す。
 * tool_choice でツール使用を強制し、確実に JSON を得る。
 * categoryNames にアクティブな費目名を渡すと suggestedCategory を enum で制約する。
 * 行が1件も読めなければ lines は空配列（呼び出し側で手動行追加により復旧できる）。
 */
export async function extractCardStatement(
    base64: string,
    mimeType: string,
    categoryNames: string[] = []
): Promise<ExtractedCardStatement> {
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
        // 6ページ・100行超の明細に対応（4000 では tool input が途中で切れる）
        max_tokens: 16000,
        tools: [
            {
                name: 'record_card_statement',
                description: 'クレジットカード明細書から抽出したヘッダ情報と全明細行を記録する',
                input_schema: buildInputSchema(categoryNames) as Anthropic.Tool.InputSchema,
            },
        ],
        tool_choice: { type: 'tool', name: 'record_card_statement' },
        messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: buildPrompt(categoryNames) }] }],
    });

    // max_tokens で打ち切られた tool input は不完全な JSON になるため明示エラーにする
    if (res.stop_reason === 'max_tokens') {
        throw new Error('明細の行数が多く、読み取りが途中で打ち切られました。PDFを分割してアップロードしてください');
    }

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('明細書の読み取りに失敗しました');
    }
    const raw = toolUse.input as Record<string, unknown>;
    const header = (raw.statement ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : [];

    const lines: ExtractedStatementLine[] = rawLines
        .map((r) => ({
            useMonth: intInRange(r.useMonth, 1, 12),
            useDay: intInRange(r.useDay, 1, 31),
            storeName: str(r.storeName) ?? '',
            storeCategory: str(r.storeCategory),
            foreignAmount: posOrNull(numSigned(r.foreignAmount)),
            currency: str(r.currency),
            exchangeRate: posOrNull(numSigned(r.exchangeRate)),
            amount: numSigned(r.amount) ?? 0,
            itemDetails: str(r.itemDetails),
            suggestedCategory: str(r.suggestedCategory),
        }))
        .filter((l) => l.storeName !== '' || l.amount !== 0); // 完全に空の行だけ落とす

    const computedTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

    return {
        memberName: str(header.memberName),
        cardLast4: str(header.cardLast4),
        closingDate: str(header.closingDate),
        totalAmount: posOrNull(numSigned(header.totalAmount)),
        lines,
        computedTotal,
    };
}
