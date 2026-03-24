import { GET } from '@/app/api/estimates/next-number/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        estimate: {
            findFirst: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
}));

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

describe('/api/estimates/next-number', () => {
    const currentYear = new Date().getFullYear();

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

        it('既存の見積がない場合は ${year}-0001 を返す', async () => {
            (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await GET();
            const data = await res.json();

            expect(data.nextNumber).toBe(`${currentYear}-0001`);
        });

        it('既存の見積がある場合はインクリメントした番号を返す', async () => {
            (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
                estimateNumber: `${currentYear}-0042`,
            });

            const res = await GET();
            const data = await res.json();

            expect(data.nextNumber).toBe(`${currentYear}-0043`);
        });

        it('パースできない見積番号の場合は ${year}-0001 を返す(NaN fallback)', async () => {
            (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
                estimateNumber: `${currentYear}-invalid`,
            });

            const res = await GET();
            const data = await res.json();

            expect(data.nextNumber).toBe(`${currentYear}-0001`);
        });

        it('DBエラー発生時は500を返す', async () => {
            (prisma.estimate.findFirst as jest.Mock).mockRejectedValue(new Error('DB error'));

            const res = await GET();
            expect(res.status).toBe(500);
        });
    });
});
