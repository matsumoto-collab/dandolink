/**
 * @jest-environment node
 */
import { extractReceipts } from '@/lib/receiptExtract';
import { getAnthropic } from '@/lib/anthropic';

jest.mock('@/lib/anthropic', () => ({
    getAnthropic: jest.fn(),
    INVOICE_EXTRACT_MODEL: 'claude-sonnet-4-6',
}));

// getAnthropic().messages.create をフィクスチャ応答にし、渡した引数を返す
function clientReturning(receipts: Record<string, unknown>[]) {
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'tool_use', input: { receipts } }] });
    (getAnthropic as jest.Mock).mockReturnValue({ messages: { create } });
    return create;
}

describe('extractReceipts', () => {
    beforeEach(() => jest.clearAllMocks());

    it('splits one image into multiple receipts', async () => {
        clientReturning([
            { storeName: 'A', totalAmount: 1000 },
            { storeName: 'B', totalAmount: 2000 },
        ]);
        const r = await extractReceipts('b64', 'image/webp', []);
        expect(r).toHaveLength(2);
        expect(r[0].storeName).toBe('A');
        expect(r[1].totalAmount).toBe(2000);
    });

    it('injects category names into the prompt and constrains each item with an enum', async () => {
        const create = clientReturning([{ storeName: 'A', totalAmount: 1000 }]);
        await extractReceipts('b64', 'image/webp', ['材料費', '交際費']);

        const args = create.mock.calls[0][0];
        const textBlock = args.messages[0].content.find((b: { type: string }) => b.type === 'text');
        expect(textBlock.text).toContain('材料費 / 交際費');
        expect(args.tools[0].input_schema.properties.receipts.items.properties.suggestedCategory.enum).toEqual(['材料費', '交際費', '']);
    });

    it('omits the enum when no categories are provided', async () => {
        const create = clientReturning([{ storeName: 'A', totalAmount: 1000 }]);
        await extractReceipts('b64', 'image/webp', []);
        expect(create.mock.calls[0][0].tools[0].input_schema.properties.receipts.items.properties.suggestedCategory.enum).toBeUndefined();
    });

    it('normalizes amounts and trims/empties strings', async () => {
        clientReturning([{ storeName: ' セブン ', totalAmount: '1,234円', taxAmount: '112', summary: '', suggestedCategory: '材料費' }]);
        const [r] = await extractReceipts('b64', 'image/webp', ['材料費']);
        expect(r.storeName).toBe('セブン');
        expect(r.totalAmount).toBe(1234);
        expect(r.taxAmount).toBe(112);
        expect(r.summary).toBeNull();
        expect(r.suggestedCategory).toBe('材料費');
    });

    it('drops empty entries (no store name and no amount)', async () => {
        clientReturning([
            { storeName: 'A', totalAmount: 100 },
            { storeName: '', totalAmount: null },
        ]);
        const r = await extractReceipts('b64', 'image/webp', []);
        expect(r).toHaveLength(1);
    });

    it('returns an empty array when nothing is readable', async () => {
        clientReturning([]);
        const r = await extractReceipts('b64', 'image/webp', []);
        expect(r).toEqual([]);
    });

    it('sends a document block for PDFs and an image block for images', async () => {
        const createPdf = clientReturning([{ storeName: 'A', totalAmount: 1 }]);
        await extractReceipts('b64', 'application/pdf', []);
        const pdfSrc = createPdf.mock.calls[0][0].messages[0].content[0];
        expect(pdfSrc.type).toBe('document');
        expect(pdfSrc.source.media_type).toBe('application/pdf');

        const createImg = clientReturning([{ storeName: 'A', totalAmount: 1 }]);
        await extractReceipts('b64', 'image/webp', []);
        const imgSrc = createImg.mock.calls[0][0].messages[0].content[0];
        expect(imgSrc.type).toBe('image');
        expect(imgSrc.source.media_type).toBe('image/webp');
    });

    it('throws when the model returns no tool_use', async () => {
        (getAnthropic as jest.Mock).mockReturnValue({ messages: { create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x' }] }) } });
        await expect(extractReceipts('b64', 'image/webp', [])).rejects.toThrow('領収書の読み取りに失敗しました');
    });
});
