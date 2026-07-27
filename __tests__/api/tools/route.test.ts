/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/tools/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        tool: { findMany: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
        toolCategory: { findUnique: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    requireManagerOrAbove: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
    validateStringField: jest.fn().mockImplementation((value: unknown) => String(value ?? '').trim()),
}));

jest.mock('@/lib/tools/names', () => ({
    resolveProjectNames: jest.fn().mockResolvedValue(new Map([['pm-1', '山田様邸']])),
    resolveUserNames: jest.fn().mockResolvedValue(new Map([['user-2', '田中']])),
}));

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

const storedTool = {
    id: 'tool-1',
    categoryId: 'cat-1',
    name: '#1',
    status: 'checked_out',
    projectMasterId: 'pm-1',
    destinationNote: null,
    holderId: 'user-2',
    checkedOutAt: new Date('2026-07-20T00:00:00Z'),
    note: null,
    sortOrder: 0,
    isActive: true,
    category: { name: 'インパクトドライバー' },
};

describe('GET /api/tools', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'user-1', role: 'manager' } }, error: null });
        (prisma.tool.findMany as jest.Mock).mockResolvedValue([storedTool]);
    });

    it('持出し先と持出者の名前を解決して返す', async () => {
        const res = await GET();
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json[0].categoryName).toBe('インパクトドライバー');
        expect(json[0].projectName).toBe('山田様邸');
        expect(json[0].holderName).toBe('田中');
    });

    it.each(['partner', 'partner_member', 'worker', 'accountant'])('%s ロールも一覧を閲覧できる', async (role) => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u-9', role } }, error: null });

        const res = await GET();

        expect(res.status).toBe(200);
    });
});

describe('POST /api/tools', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'user-1', role: 'manager' } }, error: null });
        (prisma.toolCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'cat-1', name: 'インパクトドライバー', isActive: true });
        (prisma.tool.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 2 } });
        (prisma.tool.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: 'tool-9', ...data }));
    });

    it('管理者・マネージャーは工具を登録できる', async () => {
        const res = await POST(makeRequest({ categoryId: 'cat-1', name: '#3' }));

        expect(res.status).toBe(201);
        const createArg = (prisma.tool.create as jest.Mock).mock.calls[0][0];
        expect(createArg.data.categoryId).toBe('cat-1');
        expect(createArg.data.sortOrder).toBe(3);
    });

    it('権限が無いロールは登録できない', async () => {
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({
            session: null,
            error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
        });

        const res = await POST(makeRequest({ categoryId: 'cat-1', name: '#3' }));

        expect(res.status).toBe(403);
        expect(prisma.tool.create).not.toHaveBeenCalled();
    });

    it('存在しない種類を指定すると 404', async () => {
        (prisma.toolCategory.findUnique as jest.Mock).mockResolvedValue(null);

        const res = await POST(makeRequest({ categoryId: 'missing', name: '#3' }));

        expect(res.status).toBe(404);
        expect(prisma.tool.create).not.toHaveBeenCalled();
    });

    it('種類の指定が無ければ 400', async () => {
        const res = await POST(makeRequest({ name: '#3' }));

        expect(res.status).toBe(400);
        expect(prisma.tool.create).not.toHaveBeenCalled();
    });
});
