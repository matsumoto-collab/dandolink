/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/calendar/vacations/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        vacationRecord: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => typeof val === 'string' ? JSON.parse(val) : val,
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/calendar/vacations', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockVacation = {
        dateKey: '2023-10-01',
        employeeIds: '["emp-1"]',
        remarks: 'Vacation',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should fetch vacations and map to object', async () => {
            (prisma.vacationRecord.findMany as jest.Mock).mockResolvedValue([mockVacation]);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json['2023-10-01']).toEqual({
                employeeIds: ['emp-1'],
                remarks: 'Vacation',
            });
        });
    });

    describe('POST', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/calendar/vacations', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create/update vacation successfully', async () => {
            (prisma.vacationRecord.upsert as jest.Mock).mockResolvedValue(mockVacation);

            const body = { dateKey: '2023-10-01', employeeIds: ['emp-1'], remarks: 'Vacation' };
            const res = await POST(createReq(body));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.employeeIds).toEqual(['emp-1']);
            expect(prisma.vacationRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { dateKey: '2023-10-01' },
            }));
        });

        it('should delete vacation if employeeIds empty and remarks empty', async () => {
            const body = { dateKey: '2023-10-01', employeeIds: [], remarks: '' };
            const res = await POST(createReq(body));
            const json = await res.json();

            expect(json.deleted).toBe(true);
            expect(prisma.vacationRecord.deleteMany).toHaveBeenCalledWith({ where: { dateKey: '2023-10-01' } });
        });

        it('should return 400 if dateKey is missing', async () => {
            const res = await POST(createReq({}));
            expect(res.status).toBe(400);
        });
    });
});
