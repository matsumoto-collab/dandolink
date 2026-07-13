/**
 * @jest-environment node
 */
import { extractSupplierInvoice, normalizeRegistrationNumber } from '@/lib/supplierInvoiceExtract';
import { getAnthropic } from '@/lib/anthropic';

jest.mock('@/lib/anthropic', () => ({
    getAnthropic: jest.fn(),
    INVOICE_EXTRACT_MODEL: 'claude-sonnet-4-6',
}));

// getAnthropic().messages.create をフィクスチャ応答にし、渡した引数を返す
function clientReturning(input: Record<string, unknown>) {
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'tool_use', input }] });
    (getAnthropic as jest.Mock).mockReturnValue({ messages: { create } });
    return create;
}

describe('extractSupplierInvoice', () => {
    beforeEach(() => jest.clearAllMocks());

    it('extracts and normalizes all fields', async () => {
        clientReturning({
            payeeName: ' 株式会社山田建材 ',
            payeeKana: 'ヤマダケンザイ',
            bankName: '愛媛銀行',
            branchName: '本店',
            accountType: '普通預金',
            accountNumber: '1234567',
            accountHolder: 'カ）ヤマダケンザイ',
            issueDate: '2026-06-30',
            dueDate: '2026-07-31',
            totalAmount: '1,234,500円',
            taxAmount: 112227,
            registrationNumber: 't1234567890123',
        });
        const r = await extractSupplierInvoice('b64', 'image/webp');
        expect(r.payeeName).toBe('株式会社山田建材');
        expect(r.accountType).toBe('普通');
        expect(r.totalAmount).toBe(1234500);
        expect(r.taxAmount).toBe(112227);
        expect(r.dueDate).toBe('2026-07-31');
        expect(r.registrationNumber).toBe('T1234567890123');
    });

    it('drops unknown account types and keeps 当座', async () => {
        clientReturning({ payeeName: 'A', totalAmount: 100, accountType: '当座預金' });
        const r = await extractSupplierInvoice('b64', 'image/webp');
        expect(r.accountType).toBe('当座');

        clientReturning({ payeeName: 'A', totalAmount: 100, accountType: '定期' });
        const r2 = await extractSupplierInvoice('b64', 'image/webp');
        expect(r2.accountType).toBeNull();
    });

    it('sends a document block for PDFs and an image block for images', async () => {
        const createPdf = clientReturning({ payeeName: 'A', totalAmount: 1 });
        await extractSupplierInvoice('b64', 'application/pdf');
        const pdfSrc = createPdf.mock.calls[0][0].messages[0].content[0];
        expect(pdfSrc.type).toBe('document');
        expect(pdfSrc.source.media_type).toBe('application/pdf');

        const createImg = clientReturning({ payeeName: 'A', totalAmount: 1 });
        await extractSupplierInvoice('b64', 'image/webp');
        const imgSrc = createImg.mock.calls[0][0].messages[0].content[0];
        expect(imgSrc.type).toBe('image');
        expect(imgSrc.source.media_type).toBe('image/webp');
    });

    it('forces the record_supplier_invoice tool', async () => {
        const create = clientReturning({ payeeName: 'A', totalAmount: 1 });
        await extractSupplierInvoice('b64', 'image/webp');
        expect(create.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'record_supplier_invoice' });
    });

    it('throws when the model returns no tool_use', async () => {
        (getAnthropic as jest.Mock).mockReturnValue({ messages: { create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x' }] }) } });
        await expect(extractSupplierInvoice('b64', 'image/webp')).rejects.toThrow('請求書の読み取りに失敗しました');
    });
});

describe('normalizeRegistrationNumber', () => {
    it('normalizes fullwidth / hyphenated / lowercase forms to T+13 digits', () => {
        expect(normalizeRegistrationNumber('T1234567890123')).toBe('T1234567890123');
        expect(normalizeRegistrationNumber('t1234567890123')).toBe('T1234567890123');
        expect(normalizeRegistrationNumber('T-1234-5678-90123')).toBe('T1234567890123');
        expect(normalizeRegistrationNumber('Ｔ１２３４５６７８９０１２３')).toBe('T1234567890123');
    });

    it('rejects invalid forms (no guessing)', () => {
        expect(normalizeRegistrationNumber('1234567890123')).toBeNull(); // T なし
        expect(normalizeRegistrationNumber('T123456789012')).toBeNull(); // 12桁
        expect(normalizeRegistrationNumber('')).toBeNull();
        expect(normalizeRegistrationNumber(null)).toBeNull();
    });
});
