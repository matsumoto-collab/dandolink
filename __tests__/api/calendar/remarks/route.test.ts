/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/calendar/remarks/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        calendarRemark: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/calendar/remarks', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockRemark = { dateKey: '2023-10-01', text: 'Holiday' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch remarks and map to object', async () => {
            (prisma.calendarRemark.findMany as jest.Mock).mockResolvedValue([mockRemark]);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json['2023-10-01']).toBe('Holiday');
        });
    });

    describe('POST', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/calendar/remarks', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create/update remark successfully', async () => {
            (prisma.calendarRemark.upsert as jest.Mock).mockResolvedValue(mockRemark);

            const body = { dateKey: '2023-10-01', text: 'Holiday' };
            const res = await POST(createReq(body));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual(mockRemark);
        });

        it('should delete remark if text is empty', async () => {
            const body = { dateKey: '2023-10-01', text: '' };
            const res = await POST(createReq(body));
            const json = await res.json();

            expect(json.deleted).toBe(true);
            expect(prisma.calendarRemark.deleteMany).toHaveBeenCalledWith({ where: { dateKey: '2023-10-01' } });
        });

        it('should return 400 if dateKey is missing', async () => {
            const res = await POST(createReq({ text: 'test' }));
            expect(res.status).toBe(400);
        });
    });
});
