import { NextRequest, NextResponse } from 'next/server';
import { PATCH, DELETE } from '@/app/api/master-data/construction-suffixes/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

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
            update: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
    validationErrorResponse: jest.fn(),
    errorResponse: jest.fn(),
}));

jest.mock('@/utils/permissions', () => ({
    isManagerOrAbove: jest.fn(),
}));

describe('/api/master-data/construction-suffixes/[id]', () => {
    const mockSession = { user: { role: 'admin' } };
    const mockContext = { params: Promise.resolve({ id: 'doc-1' }) };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ error: null, session: mockSession });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
        
        // Setup default mock responses for utility functions
        (validationErrorResponse as jest.Mock).mockImplementation((msg) => {
            return NextResponse.json({ error: msg }, { status: 400 });
        });
        (errorResponse as jest.Mock).mockImplementation((msg, status) => {
            return NextResponse.json({ error: msg }, { status });
        });
    });

    describe('PATCH', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponseObj = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponseObj });

            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'update' }),
            });
            const res = await PATCH(req, mockContext);

            expect(res).toBe(errorResponseObj);
        });

        it('権限がない場合は403エラーレスポンスを返す', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'update' }),
            });
            const res = await PATCH(req, mockContext) as any;
            const data = await res.json();

            expect(res.status).toBe(403);
            expect(data.error).toBe('権限がありません');
        });

        it('名前が空の場合はバリデーションエラーを返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: '   ' }),
            });

            const res = await PATCH(req, mockContext) as any;
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toBe('名前は必須です');
        });

        it('名前が100文字を超える場合はバリデーションエラーを返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'a'.repeat(101) }),
            });

            const res = await PATCH(req, mockContext) as any;
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toBe('名前は100文字以内で入力してください');
        });

        it('正常にデータを更新して返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: '修正後', sortOrder: 10 }),
            });

            const mockUpdated = { id: 'doc-1', name: '修正後', sortOrder: 10 };
            (prisma.constructionSuffix.update as jest.Mock).mockResolvedValue(mockUpdated);

            const res = await PATCH(req, mockContext) as any;
            const data = await res.json();

            expect(prisma.constructionSuffix.update).toHaveBeenCalledWith({
                where: { id: 'doc-1' },
                data: { name: '修正後', sortOrder: 10 },
            });
            expect(data).toEqual(mockUpdated);
        });

        it('更新時に例外が発生した場合は500を返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'PATCH',
                body: JSON.stringify({ name: '修正後' }),
            });

            (prisma.constructionSuffix.update as jest.Mock).mockRejectedValue(new Error('DB error'));

            const res = await PATCH(req, mockContext) as any;
            expect(res.status).toBe(500);
        });
    });

    describe('DELETE', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponseObj = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponseObj });

            const req = new NextRequest('http://localhost:3000', { method: 'DELETE' });
            const res = await DELETE(req, mockContext);

            expect(res).toBe(errorResponseObj);
        });

        it('権限がない場合は403エラーレスポンスを返す', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;
            const data = await res.json();

            expect(res.status).toBe(403);
            expect(data.error).toBe('権限がありません');
        });

        it('正常にデータを論理削除して返す', async () => {
            const req = new NextRequest('http://localhost:3000', { method: 'DELETE' });

            (prisma.constructionSuffix.update as jest.Mock).mockResolvedValue({ id: 'doc-1', isActive: false });

            const res = await DELETE(req, mockContext) as any;
            const data = await res.json();

            expect(prisma.constructionSuffix.update).toHaveBeenCalledWith({
                where: { id: 'doc-1' },
                data: { isActive: false },
            });
            expect(data).toEqual({ success: true });
        });

        it('削除時に例外が発生した場合は500を返す', async () => {
            const req = new NextRequest('http://localhost:3000', { method: 'DELETE' });

            (prisma.constructionSuffix.update as jest.Mock).mockRejectedValue(new Error('DB error'));

            const res = await DELETE(req, mockContext) as any;
            expect(res.status).toBe(500);
        });
    });
});
