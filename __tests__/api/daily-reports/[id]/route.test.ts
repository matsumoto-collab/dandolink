/**
 * @jest-environment node
 */
import { GET, DELETE } from '@/app/api/daily-reports/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        dailyReport: {
            findUnique: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

jest.mock('@/utils/permissions', () => ({
    isManagerOrAbove: jest.fn(),
}));

describe('/api/daily-reports/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'report-1';
    const mockReport = {
        id: mockId,
        foremanId: 'user-1',
        content: 'Test Report',
        workItems: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(false);
    });

    describe('GET', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/daily-reports/${mockId}`);
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should fetch report successfully', async () => {
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(mockReport);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.content).toBe(mockReport.content);
        });

        it('should return 404 if report not found', async () => {
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await GET(createReq(), context);
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/daily-reports/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should delete report successfully by foreman', async () => {
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(mockReport);
            // user-1 is foreman (matches foremanId)

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.dailyReport.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should delete report successfully by manager', async () => {
            const otherReport = { ...mockReport, foremanId: 'other-user' };
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(otherReport);
            (isManagerOrAbove as jest.Mock).mockReturnValue(true);

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
        });

        it('should return 403 if user is not foreman nor manager', async () => {
            const otherReport = { ...mockReport, foremanId: 'other-user' };
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(otherReport);
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(403);
            expect(prisma.dailyReport.delete).not.toHaveBeenCalled();
        });

        it('should return 404 if report not found', async () => {
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(404);
        });
    });
});
