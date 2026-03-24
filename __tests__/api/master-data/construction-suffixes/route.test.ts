import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/master-data/construction-suffixes/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, validateStringField } from '@/lib/api/utils';

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

jest.mock('@/lib/prisma', () => ({
    prisma: {
        constructionSuffix: {
            findMany: jest.fn(),
            aggregate: jest.fn(),
            create: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
    validateStringField: jest.fn(),
}));

describe('/api/master-data/construction-suffixes', () => {
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

        it('有効な工事名称一覧を取得して返す', async () => {
            const mockSuffixes = [
                { id: '1', name: '邸新築工事', sortOrder: 1 },
                { id: '2', name: '様修繕', sortOrder: 2 },
            ];
            (prisma.constructionSuffix.findMany as jest.Mock).mockResolvedValue(mockSuffixes);

            const res = await GET();
            const data = await res.json();

            expect(prisma.constructionSuffix.findMany).toHaveBeenCalledWith({
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
            });
            expect(data).toEqual(mockSuffixes);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
        });

        it('取得時に例外が発生した場合は500を返す', async () => {
            (prisma.constructionSuffix.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const res = await GET();
            expect(res.status).toBe(500);
        });
    });

    describe('POST', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponse = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponse });

            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ name: '邸' }),
            });
            const res = await POST(req);

            expect(res).toBe(errorResponse);
        });

        it('名前のバリデーションエラーの場合はそのレスポンスを返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ name: '' }),
            });
            
            const validationErrorResponse = NextResponse.json({ error: 'invalid' }, { status: 400 });
            (validateStringField as jest.Mock).mockReturnValue(validationErrorResponse);

            const res = await POST(req);
            expect(res).toBe(validationErrorResponse);
        });

        it('正常に工事名称を作成して返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ name: '新規工事' }),
            });

            (validateStringField as jest.Mock).mockReturnValue('新規工事');
            (prisma.constructionSuffix.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 5 } });
            
            const mockCreated = { id: '3', name: '新規工事', sortOrder: 6 };
            (prisma.constructionSuffix.create as jest.Mock).mockResolvedValue(mockCreated);

            const res = await POST(req);
            const data = await res.json();

            expect(prisma.constructionSuffix.aggregate).toHaveBeenCalledWith({ _max: { sortOrder: true } });
            expect(prisma.constructionSuffix.create).toHaveBeenCalledWith({
                data: { name: '新規工事', sortOrder: 6 },
            });
            expect(res.status).toBe(201);
            expect(data).toEqual(mockCreated);
        });

        it('既存データがない場合の新規作成でのソート順対応', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ name: '新規工事' }),
            });

            (validateStringField as jest.Mock).mockReturnValue('新規工事');
            (prisma.constructionSuffix.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: null } });
            
            (prisma.constructionSuffix.create as jest.Mock).mockResolvedValue({});

            await POST(req);

            expect(prisma.constructionSuffix.create).toHaveBeenCalledWith(expect.objectContaining({
                data: { name: '新規工事', sortOrder: 0 },
            }));
        });

        it('作成時に例外が発生した場合は500を返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ name: '新規工事' }),
            });

            (validateStringField as jest.Mock).mockReturnValue('新規工事');
            (prisma.constructionSuffix.aggregate as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const res = await POST(req);
            expect(res.status).toBe(500);
        });
    });
});
