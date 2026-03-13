import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/system-settings/foremen/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, parseJsonField } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        systemSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    requireManagerOrAbove: jest.fn(),
    parseJsonField: jest.fn(),
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
    class MockNextResponse {
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
        static json(body: any, init?: any) {
            return new MockNextResponse(JSON.stringify(body), {
                status: init?.status || 200,
                headers: init?.headers,
            });
        }
    }

    return {
        NextRequest: class NextRequest {
            url: string;
            method: string;
            _body: any;
            constructor(url: string, init?: any) {
                this.url = url;
                this.method = init?.method || 'GET';
                this._body = init?.body;
            }
            async json() {
                if (typeof this._body === 'string') return JSON.parse(this._body);
                return this._body;
            }
        },
        NextResponse: MockNextResponse
    };
});

describe('/api/system-settings/foremen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ error: null });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ error: null });
    });

    describe('GET', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponseObj = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponseObj });

            const res = await GET() as any;
            expect(res).toBe(errorResponseObj);
        });

        it('設定が見つからない場合は空の配列を返す', async () => {
            (prisma.systemSettings.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await GET() as any;
            const data = await res.json();

            expect(data.displayedForemanIds).toEqual([]);
        });

        it('設定が存在する場合はパースして返す', async () => {
            const mockSettings = { displayedForemanIds: '["user-1", "user-2"]' };
            (prisma.systemSettings.findUnique as jest.Mock).mockResolvedValue(mockSettings);
            (parseJsonField as jest.Mock).mockReturnValue(['user-1', 'user-2']);

            const res = await GET() as any;
            const data = await res.json();

            expect(parseJsonField).toHaveBeenCalledWith('["user-1", "user-2"]', []);
            expect(data.displayedForemanIds).toEqual(['user-1', 'user-2']);
        });

        it('取得時にエラーが発生した場合は500を返す', async () => {
            (prisma.systemSettings.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));

            const res = await GET() as any;
            expect(res.status).toBe(500);
        });
    });

    describe('PATCH', () => {
        it('Manager以上の権限がない場合はエラーレスポンスを返す', async () => {
            const errorResponseObj = new Response('Forbidden', { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ error: errorResponseObj });

            const req = new NextRequest('http://localhost:3000/api', { method: 'PATCH', body: JSON.stringify({}) });
            const res = await PATCH(req) as any;

            expect(res).toBe(errorResponseObj);
        });

        it('正常に設定を更新して返す', async () => {
            const req = new NextRequest('http://localhost:3000/api', {
                method: 'PATCH',
                body: JSON.stringify({ displayedForemanIds: ['user-3'] }),
            });

            const mockUpdated = { displayedForemanIds: '["user-3"]' };
            (prisma.systemSettings.upsert as jest.Mock).mockResolvedValue(mockUpdated);
            (parseJsonField as jest.Mock).mockReturnValue(['user-3']);

            const res = await PATCH(req) as any;
            const data = await res.json();

            expect(prisma.systemSettings.upsert).toHaveBeenCalledWith({
                where: { id: 'default' },
                update: { displayedForemanIds: '["user-3"]' },
                create: { id: 'default', displayedForemanIds: '["user-3"]' },
            });
            expect(data.displayedForemanIds).toEqual(['user-3']);
        });

        it('更新パラメータが未定義の場合は空配列を保存する', async () => {
            const req = new NextRequest('http://localhost:3000/api', {
                method: 'PATCH',
                body: JSON.stringify({}),
            });

            const mockUpdated = { displayedForemanIds: '[]' };
            (prisma.systemSettings.upsert as jest.Mock).mockResolvedValue(mockUpdated);
            (parseJsonField as jest.Mock).mockReturnValue([]);

            const res = await PATCH(req) as any;
            const data = await res.json();

            expect(prisma.systemSettings.upsert).toHaveBeenCalledWith({
                where: { id: 'default' },
                update: { displayedForemanIds: '[]' },
                create: { id: 'default', displayedForemanIds: '[]' },
            });
            expect(data.displayedForemanIds).toEqual([]);
        });

        it('更新時にエラーが発生した場合は500を返す', async () => {
            const req = new NextRequest('http://localhost:3000/api', {
                method: 'PATCH',
                body: JSON.stringify({ displayedForemanIds: ['user-3'] }),
            });

            (prisma.systemSettings.upsert as jest.Mock).mockRejectedValue(new Error('DB error'));

            const res = await PATCH(req) as any;
            expect(res.status).toBe(500);
        });
    });
});
