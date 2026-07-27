/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/estimates/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest } from 'next/server';

describe('/api/estimates', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should return estimates list', async () => {
            const mockEstimates = [
                { id: '1', estimateNumber: 'EST-001', items: '[]', createdAt: new Date(), validUntil: new Date() },
            ];
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);

            const req = new NextRequest('http://localhost:3000/api/estimates');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
        });

        it('should handle pagination', async () => {
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.estimate.count as jest.Mock).mockResolvedValue(0);

            const req = new NextRequest('http://localhost:3000/api/estimates?page=1&limit=10');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.data).toEqual([]);
        });
    });

    describe('POST', () => {
        const validBody = {
            projectMasterId: 'pm-1',
            estimateNumber: 'EST-001',
            title: 'Estimate 1',
            items: [],
            subtotal: 1000,
            tax: 100,
            total: 1100,
            validUntil: '2023-01-31',
        };

        it('should create an estimate', async () => {
            const createdEstimate = {
                id: 'new-1',
                ...validBody,
                items: JSON.stringify(validBody.items),
                createdAt: new Date(),
                updatedAt: new Date(),
                validUntil: new Date(validBody.validUntil)
            };
            (prisma.estimate.create as jest.Mock).mockResolvedValue(createdEstimate);

            const req = new NextRequest('http://localhost:3000/api/estimates', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.estimate.create).toHaveBeenCalled();
        });

        it('見積日(createdAt)を指定するとその日付で作成される', async () => {
            (prisma.estimate.create as jest.Mock).mockResolvedValue({
                id: 'new-1', ...validBody, items: '[]',
                createdAt: new Date('2026-03-31'), updatedAt: new Date(), validUntil: new Date(validBody.validUntil),
            });

            const req = new NextRequest('http://localhost:3000/api/estimates', {
                method: 'POST',
                body: JSON.stringify({ ...validBody, createdAt: '2026-03-31' }),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            const createArg = (prisma.estimate.create as jest.Mock).mock.calls[0][0];
            expect(createArg.data.createdAt).toEqual(new Date('2026-03-31'));
        });

        it('見積日を省略したら createdAt は渡さない（DBの既定値に任せる）', async () => {
            (prisma.estimate.create as jest.Mock).mockResolvedValue({
                id: 'new-1', ...validBody, items: '[]',
                createdAt: new Date(), updatedAt: new Date(), validUntil: new Date(validBody.validUntil),
            });

            const req = new NextRequest('http://localhost:3000/api/estimates', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            await POST(req);

            const createArg = (prisma.estimate.create as jest.Mock).mock.calls[0][0];
            expect(createArg.data.createdAt).toBeUndefined();
        });

        it('should return 400 validation error for missing fields', async () => {
            // estimateNumber は自動採番対応で省略可になったため、必須の title 欠落で検証する
            const invalidBody = { ...validBody, title: undefined };

            const req = new NextRequest('http://localhost:3000/api/estimates', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });
    });
});
