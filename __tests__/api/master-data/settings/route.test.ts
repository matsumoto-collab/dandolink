/**
 * @jest-environment node
 */
import { GET, PATCH } from '@/app/api/master-data/settings/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        systemSettings: {
            findFirst: jest.fn(),
            create: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/master-data/settings', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockSettings = { id: 'default', totalMembers: 20 };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch settings', async () => {
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(mockSettings);
        });

        it('should create default if not found', async () => {
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.systemSettings.create as jest.Mock).mockResolvedValue(mockSettings);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(mockSettings);
        });
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/settings', {
            method: 'PATCH',
            body: JSON.stringify(body),
        });

        it('should update settings successfully', async () => {
            (prisma.systemSettings.upsert as jest.Mock).mockResolvedValue({ ...mockSettings, totalMembers: 30 });

            const res = await PATCH(createReq({ totalMembers: 30 }));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.totalMembers).toBe(30);
        });

        it('should return 400 for invalid totalMembers', async () => {
            const res = await PATCH(createReq({ totalMembers: 0 }));
            expect(res.status).toBe(400);
        });
    });
});
