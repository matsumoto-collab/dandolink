/**
 * @jest-environment node
 */
import { GET, PATCH } from '@/app/api/user-settings/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        userSettings: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => typeof val === 'string' ? JSON.parse(val) : val,
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/user-settings', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockSettings = { userId: 'user-1', displayedForemanIds: '["foreman-1"]' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch user settings', async () => {
            (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue(mockSettings);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.displayedForemanIds).toEqual(['foreman-1']);
        });

        it('should return empty array if no settings found', async () => {
            (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.displayedForemanIds).toEqual([]);
        });
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/user-settings', {
            method: 'PATCH',
            body: JSON.stringify(body),
        });

        it('should update user settings successfully', async () => {
            (prisma.userSettings.upsert as jest.Mock).mockResolvedValue(mockSettings);

            const body = { displayedForemanIds: ['foreman-1'] };
            const res = await PATCH(createReq(body));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.displayedForemanIds).toEqual(['foreman-1']);
            expect(prisma.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { userId: 'user-1' },
                update: { displayedForemanIds: JSON.stringify(['foreman-1']) },
            }));
        });
    });
});
