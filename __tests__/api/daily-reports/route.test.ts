/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/daily-reports/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/daily-reports', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should return daily reports list', async () => {
            const mockReports = [
                { id: '1', foremanId: 'f1', date: new Date(), notes: 'Test' },
            ];
            (prisma.dailyReport.findMany as jest.Mock).mockResolvedValue(mockReports);

            const req = new NextRequest('http://localhost:3000/api/daily-reports?foremanId=f1');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
            expect(prisma.dailyReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ foremanId: 'f1' })
            }));
        });

        it('should handle date range search', async () => {
            (prisma.dailyReport.findMany as jest.Mock).mockResolvedValue([]);

            const req = new NextRequest('http://localhost:3000/api/daily-reports?startDate=2023-01-01&endDate=2023-01-31');
            await GET(req);

            expect(prisma.dailyReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    date: {
                        gte: expect.any(Date),
                        lte: expect.any(Date)
                    }
                })
            }));
        });
    });

    describe('POST', () => {
        const validBody = {
            foremanId: 'f1',
            date: '2023-01-01',
            morningLoadingMinutes: 30,
            eveningLoadingMinutes: 30,
            workItems: [
                { assignmentId: 'a1', workMinutes: 480 }
            ]
        };

        it('should upsert a daily report', async () => {
            const upsertedReport = {
                id: 'dr-1',
                foremanId: 'f1',
                date: new Date('2023-01-01'),
                morningLoadingMinutes: 30
            };
            (prisma.dailyReport.upsert as jest.Mock).mockResolvedValue(upsertedReport);
            (prisma.dailyReport.findUnique as jest.Mock).mockResolvedValue(upsertedReport);

            const req = new NextRequest('http://localhost:3000/api/daily-reports', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(201);
            expect(prisma.dailyReport.upsert).toHaveBeenCalled();
            expect(prisma.dailyReportWorkItem.deleteMany).toHaveBeenCalled();
            expect(prisma.dailyReportWorkItem.createMany).toHaveBeenCalled();
        });

        it('should return 400 validation error for missing fields', async () => {
            const invalidBody = { ...validBody, foremanId: undefined };

            const req = new NextRequest('http://localhost:3000/api/daily-reports', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });
    });
});
