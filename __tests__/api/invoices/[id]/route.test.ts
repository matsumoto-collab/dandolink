/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/invoices/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        invoice: {
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    deleteSuccessResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ message: `${msg}を削除しました` }, { status: 200 })),
}));

jest.mock('@/lib/formatters', () => ({
    formatInvoice: (item: any) => ({
        ...item,
        items: typeof item.items === 'string' ? JSON.parse(item.items) : item.items,
        dueDate: item.dueDate ? new Date(item.dueDate).toISOString() : null,
    }),
}));

describe('/api/invoices/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'inv-1';
    const mockInvoice = {
        id: mockId,
        title: 'Test Invoice',
        items: '[]',
        dueDate: new Date('2023-12-31'),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('PATCH', () => {
        const updateBody = {
            title: 'Updated Invoice',
            status: 'sent',
            items: [{ name: 'Item 1', price: 100 }],
        };
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/invoices/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should update invoice successfully', async () => {
            (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(mockInvoice);
            (prisma.invoice.update as jest.Mock).mockResolvedValue({
                ...mockInvoice,
                ...updateBody,
                items: JSON.stringify(updateBody.items),
                status: updateBody.status,
            });

            const res = await PATCH(createReq(updateBody), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.title).toBe(updateBody.title);
            expect(json.status).toBe(updateBody.status);
            expect(json.items).toEqual(updateBody.items);
        });

        it('should return 400 for invalid status', async () => {
            (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(mockInvoice);
            const res = await PATCH(createReq({ status: 'invalid_status' }), context);
            expect(res.status).toBe(400);
        });

        it('should return 404 if invoice not found', async () => {
            (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(404);
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(401);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/invoices/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should delete invoice successfully', async () => {
            (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(mockInvoice);

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.invoice.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should return 404 if invoice not found', async () => {
            (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(404);
        });
    });
});
