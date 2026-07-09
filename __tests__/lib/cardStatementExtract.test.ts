/**
 * @jest-environment node
 */
import { extractCardStatement, resolveLineDate } from '@/lib/cardStatementExtract';
import { getAnthropic } from '@/lib/anthropic';

jest.mock('@/lib/anthropic', () => ({
    getAnthropic: jest.fn(),
    INVOICE_EXTRACT_MODEL: 'claude-sonnet-4-6',
}));

// getAnthropic().messages.create をフィクスチャ応答にし、渡した引数を返す
function clientReturning(input: Record<string, unknown>, stopReason = 'tool_use') {
    const create = jest.fn().mockResolvedValue({
        stop_reason: stopReason,
        content: [{ type: 'tool_use', input }],
    });
    (getAnthropic as jest.Mock).mockReturnValue({ messages: { create } });
    return create;
}

const HEADER = { memberName: '今井 公一郎', cardLast4: '92002', closingDate: '2026-06-18', totalAmount: 472971 };

describe('resolveLineDate', () => {
    const closing = new Date('2026-06-18T00:00:00.000Z');

    it('keeps the closing year for dates on or before the closing date', () => {
        expect(resolveLineDate(closing, 5, 15).toISOString()).toBe('2026-05-15T00:00:00.000Z');
        expect(resolveLineDate(closing, 6, 18).toISOString()).toBe('2026-06-18T00:00:00.000Z');
    });

    it('rolls back to the previous year for dates after the closing date', () => {
        expect(resolveLineDate(closing, 6, 20).toISOString()).toBe('2025-06-20T00:00:00.000Z');
        expect(resolveLineDate(closing, 12, 31).toISOString()).toBe('2025-12-31T00:00:00.000Z');
    });

    it('crosses year boundaries correctly for January closing dates', () => {
        const janClosing = new Date('2026-01-15T00:00:00.000Z');
        expect(resolveLineDate(janClosing, 12, 20).toISOString()).toBe('2025-12-20T00:00:00.000Z');
        expect(resolveLineDate(janClosing, 1, 10).toISOString()).toBe('2026-01-10T00:00:00.000Z');
    });
});

describe('extractCardStatement', () => {
    beforeEach(() => jest.clearAllMocks());

    it('extracts the header and lines with computedTotal', async () => {
        clientReturning({
            statement: HEADER,
            lines: [
                { useMonth: 5, useDay: 15, storeName: '楽天トラベル', storeCategory: '旅行代理店', amount: 11100 },
                { useMonth: 5, useDay: 20, storeName: 'SUPABASE', foreignAmount: 29.39, currency: 'USD', exchangeRate: 164.818, amount: 4844 },
            ],
        });
        const r = await extractCardStatement('b64', 'application/pdf', []);
        expect(r.memberName).toBe('今井 公一郎');
        expect(r.closingDate).toBe('2026-06-18');
        expect(r.totalAmount).toBe(472971);
        expect(r.lines).toHaveLength(2);
        expect(r.lines[1].foreignAmount).toBe(29.39);
        expect(r.lines[1].exchangeRate).toBe(164.818);
        expect(r.computedTotal).toBe(15944);
    });

    it('keeps negative amounts for refunds and includes them in computedTotal', async () => {
        clientReturning({
            statement: HEADER,
            lines: [
                { useMonth: 5, useDay: 15, storeName: 'A', amount: 10000 },
                { useMonth: 5, useDay: 20, storeName: 'B（返金）', amount: -3000 },
            ],
        });
        const r = await extractCardStatement('b64', 'application/pdf', []);
        expect(r.lines[1].amount).toBe(-3000);
        expect(r.computedTotal).toBe(7000);
    });

    it('parses wide-form negative markers (△) in string amounts', async () => {
        clientReturning({
            statement: HEADER,
            lines: [{ useMonth: 5, useDay: 15, storeName: 'A', amount: '△1,234円' }],
        });
        const r = await extractCardStatement('b64', 'application/pdf', []);
        expect(r.lines[0].amount).toBe(-1234);
    });

    it('nulls out-of-range month/day instead of dropping the line', async () => {
        clientReturning({
            statement: HEADER,
            lines: [{ useMonth: 13, useDay: 0, storeName: 'A', amount: 100 }],
        });
        const r = await extractCardStatement('b64', 'application/pdf', []);
        expect(r.lines).toHaveLength(1);
        expect(r.lines[0].useMonth).toBeNull();
        expect(r.lines[0].useDay).toBeNull();
    });

    it('drops fully empty lines but keeps zero-amount lines with a store name', async () => {
        clientReturning({
            statement: HEADER,
            lines: [
                { useMonth: 5, useDay: 15, storeName: '', amount: 0 },
                { useMonth: 5, useDay: 16, storeName: '読取困難', amount: 0 },
            ],
        });
        const r = await extractCardStatement('b64', 'application/pdf', []);
        expect(r.lines).toHaveLength(1);
        expect(r.lines[0].storeName).toBe('読取困難');
    });

    it('injects category names into the prompt and constrains lines with an enum', async () => {
        const create = clientReturning({ statement: HEADER, lines: [] });
        await extractCardStatement('b64', 'application/pdf', ['交際費', '消耗品費']);

        const args = create.mock.calls[0][0];
        const textBlock = args.messages[0].content.find((b: { type: string }) => b.type === 'text');
        expect(textBlock.text).toContain('交際費 / 消耗品費');
        expect(args.tools[0].input_schema.properties.lines.items.properties.suggestedCategory.enum).toEqual(['交際費', '消耗品費', '']);
    });

    it('omits the enum when no categories are provided', async () => {
        const create = clientReturning({ statement: HEADER, lines: [] });
        await extractCardStatement('b64', 'application/pdf', []);
        expect(create.mock.calls[0][0].tools[0].input_schema.properties.lines.items.properties.suggestedCategory.enum).toBeUndefined();
    });

    it('sends a document block for PDFs and a large max_tokens budget', async () => {
        const create = clientReturning({ statement: HEADER, lines: [] });
        await extractCardStatement('b64', 'application/pdf', []);
        const args = create.mock.calls[0][0];
        expect(args.messages[0].content[0].type).toBe('document');
        expect(args.messages[0].content[0].source.media_type).toBe('application/pdf');
        expect(args.max_tokens).toBeGreaterThanOrEqual(16000);
    });

    it('throws a clear error when the response is truncated by max_tokens', async () => {
        clientReturning({ statement: HEADER, lines: [] }, 'max_tokens');
        await expect(extractCardStatement('b64', 'application/pdf', [])).rejects.toThrow('途中で打ち切られました');
    });

    it('throws when the model returns no tool_use', async () => {
        (getAnthropic as jest.Mock).mockReturnValue({
            messages: { create: jest.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }) },
        });
        await expect(extractCardStatement('b64', 'application/pdf', [])).rejects.toThrow('明細書の読み取りに失敗しました');
    });
});
