// Define globals for Request and Response
global.Request = global.Request || class Request {} as any;
global.Response = global.Response || class Response {
    status: number;
    body: any;
    headers: Map<string, string>;
    constructor(body?: any, init?: { status?: number; headers?: any }) {
        this.status = init?.status || 200;
        this.body = body;
        this.headers = new Map(Object.entries(init?.headers || {}));
    }
    async json() {
        if (typeof this.body === 'string') return JSON.parse(this.body);
        return this.body;
    }
} as any;

jest.mock('next/server', () => {
    return {
        NextResponse: {
            json: (body: any, init?: any) => {
                return {
                    status: init?.status || 200,
                    json: async () => body,
                    headers: new Map(Object.entries(init?.headers || {})),
                };
            }
        }
    };
});

import { GET } from '@/app/api/calendar/members/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
}));

describe('/api/calendar/members', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ error: null });
    });

    describe('GET', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponse = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponse });

            const res = await GET();

            expect(res).toBe(errorResponse);
        });

        it('有効なユーザー一覧を取得して返す', async () => {
            const mockUsers = [
                { id: '1', displayName: '山田太郎' },
                { id: '2', displayName: '佐藤次郎' },
            ];
            (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const res = await GET();
            const data = await res.json();

            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: { isActive: true },
                select: { id: true, displayName: true },
                orderBy: { displayName: 'asc' },
            });
            expect(data).toEqual(mockUsers);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
        });

        it('取得時に例外が発生した場合は500を返す', async () => {
            (prisma.user.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const res = await GET();

            expect(res.status).toBe(500);
        });
    });
});
