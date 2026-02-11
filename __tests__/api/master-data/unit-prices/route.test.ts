/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/master-data/unit-prices/route';
import { PATCH, DELETE } from '@/app/api/master-data/unit-prices/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        unitPriceMaster: {
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => typeof val === 'string' ? JSON.parse(val) : val,
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/master-data/unit-prices', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockUnitPrice = {
        id: 'up-1',
        description: 'Item A',
        unit: 'm2',
        unitPrice: 1000,
        templates: '["Template A"]',
        notes: null,
        isActive: true,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch active unit prices', async () => {
            (prisma.unitPriceMaster.findMany as jest.Mock).mockResolvedValue([mockUnitPrice]);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json[0].templates).toEqual(['Template A']);
            expect(prisma.unitPriceMaster.findMany).toHaveBeenCalledWith({
                where: { isActive: true },
                orderBy: { description: 'asc' },
            });
        });
    });

    describe('POST', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/unit-prices', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create unit price successfully', async () => {
            (prisma.unitPriceMaster.create as jest.Mock).mockResolvedValue(mockUnitPrice);

            const body = {
                description: 'Item A',
                unit: 'm2',
                unitPrice: 1000,
                templates: ['Template A'],
            };
            const res = await POST(createReq(body));
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json.templates).toEqual(['Template A']);
            expect(prisma.unitPriceMaster.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    templates: JSON.stringify(['Template A']),
                }),
            }));
        });

        it('should return 400 if validation fails', async () => {
            const res = await POST(createReq({ description: '' }));
            expect(res.status).toBe(400);
        });
    });
});

describe('/api/master-data/unit-prices/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'up-1';
    const mockUnitPrice = {
        id: mockId,
        description: 'Item A',
        unit: 'm2',
        unitPrice: 1000,
        templates: '["Template A"]',
        notes: null,
        isActive: true,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/master-data/unit-prices/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: Promise.resolve({ id: mockId }) }; // Check if Promise or object is needed

        it('should update unit price successfully', async () => {
            (prisma.unitPriceMaster.update as jest.Mock).mockResolvedValue({ ...mockUnitPrice, description: 'Updated' });

            const res = await PATCH(createReq({ description: 'Updated' }), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.description).toBe('Updated');
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/master-data/unit-prices/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should soft delete unit price successfully', async () => {
            (prisma.unitPriceMaster.update as jest.Mock).mockResolvedValue({ ...mockUnitPrice, isActive: false });

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.unitPriceMaster.update).toHaveBeenCalledWith({
                where: { id: mockId },
                data: { isActive: false },
            });
        });
    });
});
