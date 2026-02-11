/**
 * @jest-environment node
 */
import { GET, PATCH } from '@/app/api/master-data/company/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        companyInfo: {
            findFirst: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/master-data/company', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockCompany = {
        id: 'default',
        name: 'Test Company',
        postalCode: '123-4567',
        address: 'Test Address',
        tel: '03-1234-5678',
        fax: null,
        representative: 'Test Rep',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch company info', async () => {
            (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(mockCompany);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(mockCompany);
        });

        it('should create default if not found', async () => {
            (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.companyInfo.create as jest.Mock).mockResolvedValue(mockCompany);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(mockCompany);
            expect(prisma.companyInfo.create).toHaveBeenCalled();
        });
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/company', {
            method: 'PATCH',
            body: JSON.stringify(body),
        });

        it('should update company info successfully', async () => {
            (prisma.companyInfo.upsert as jest.Mock).mockResolvedValue({ ...mockCompany, name: 'Updated' });

            const res = await PATCH(createReq({ name: 'Updated' }));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.name).toBe('Updated');
        });
    });
});
