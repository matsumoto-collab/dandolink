/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/estimates/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        estimate: {
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    deleteSuccessResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ message: `${msg}を削除しました` }, { status: 200 })),
}));

jest.mock('@/lib/formatters', () => ({
    formatEstimate: (item: any) => ({
        ...item,
        items: typeof item.items === 'string' ? JSON.parse(item.items) : item.items,
        validUntil: item.validUntil ? new Date(item.validUntil).toISOString() : null,
    }),
}));

describe('/api/estimates/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'est-1';
    const mockEstimate = {
        id: mockId,
        title: 'Test Estimate',
        items: '[]',
        validUntil: new Date('2023-12-31'),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('PATCH', () => {
        const updateBody = {
            title: 'Updated Estimate',
            status: 'sent',
            items: [{ name: 'Item 1', price: 100 }],
        };
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/estimates/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should update estimate successfully', async () => {
            (prisma.estimate.findUnique as jest.Mock).mockResolvedValue(mockEstimate);
            (prisma.estimate.update as jest.Mock).mockResolvedValue({
                ...mockEstimate,
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
            (prisma.estimate.findUnique as jest.Mock).mockResolvedValue(mockEstimate);
            const res = await PATCH(createReq({ status: 'invalid_status' }), context);
            expect(res.status).toBe(400);
        });

        it('should return 404 if estimate not found', async () => {
            (prisma.estimate.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(404);
        });

        it('should return 401 if unauthorized', async () => {
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(401);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/estimates/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should delete estimate successfully', async () => {
            (prisma.estimate.findUnique as jest.Mock).mockResolvedValue(mockEstimate);

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.estimate.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should return 404 if estimate not found', async () => {
            (prisma.estimate.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(404);
        });
    });
});
