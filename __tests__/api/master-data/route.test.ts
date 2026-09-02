/**
 * @jest-environment node
 */
import { GET } from '@/app/api/master-data/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        vehicle: { findMany: jest.fn() },
        tool: { findMany: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    requireManagerOrAbove: jest.fn().mockResolvedValue({ session: { user: { id: "test-user", role: "admin" } }, error: null }),
    requireAdmin: jest.fn().mockResolvedValue({ session: { user: { id: "test-user", role: "admin" } }, error: null }),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/master-data', () => {
    const mockSession = { user: { id: 'u1' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        // 電動工具（機材台帳の Tool）も同じ一括取得で返す
        (prisma.tool.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('should return all master data', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([{ id: 'v1', name: 'Vehicle 1' }]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ totalMembers: 5 });

        const res = await GET();

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
            vehicles: [{ id: 'v1', name: 'Vehicle 1', dailyRate: null }],
            tools: [],
            totalMembers: 5
        });
    });

    it('should return default totalMembers if settings not found', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);

        const res = await GET();

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.totalMembers).toBe(20); // Default value
    });

    it('should return 401 if unauthorized', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });

        const res = await GET();
        expect(res.status).toBe(401);
    });

    it('電動工具はスケジュールで選ぶのに要る項目だけ返す', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ totalMembers: 5 });
        (prisma.tool.findMany as jest.Mock).mockResolvedValue([
            {
                id: 't1', name: 'インパクト #1', categoryId: 'c1', status: 'in_stock', sortOrder: 0, isActive: true,
                category: { id: 'c1', name: '電動工具', sortOrder: 0 },
            },
        ]);

        const res = await GET();
        const json = await res.json();
        expect(json.tools).toEqual([
            { id: 't1', name: 'インパクト #1', categoryId: 'c1', categoryName: '電動工具', categorySortOrder: 0, status: 'in_stock', sortOrder: 0, isActive: true },
        ]);
    });

    it('should return 500 on db error (Promise.all failure)', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

        const res = await GET();
        expect(res.status).toBe(500);
    });
});
