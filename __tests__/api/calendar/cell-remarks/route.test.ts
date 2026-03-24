// Define globals for Request and Response before imports are evaluated if possible, 
// but in Jest, mocking next/server is safer.
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

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/calendar/cell-remarks/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        cellRemark: {
            findMany: jest.fn(),
            deleteMany: jest.fn(),
            upsert: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
}));

describe('/api/calendar/cell-remarks', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ error: null });
    });

    describe('GET', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponse = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponse });

            const req = new NextRequest('http://localhost:3000/api/calendar/cell-remarks');
            const res = await GET(req);

            expect(res).toBe(errorResponse);
        });

        it('セル備考を取得してマッピングして返す', async () => {
            const mockRemarks = [
                { foremanId: 'f1', dateKey: '2026-03-12', text: '休出' },
                { foremanId: 'f2', dateKey: '2026-03-13', text: '早出' },
            ];
            (prisma.cellRemark.findMany as jest.Mock).mockResolvedValue(mockRemarks);

            const req = new NextRequest('http://localhost:3000/api/calendar/cell-remarks');
            const res = await GET(req);
            const data = await res.json();

            expect(prisma.cellRemark.findMany).toHaveBeenCalled();
            expect(data).toEqual({
                'f1-2026-03-12': '休出',
                'f2-2026-03-13': '早出',
            });
            expect(res.headers.get('Cache-Control')).toBe('no-store');
        });

        it('取得時に例外が発生した場合は500を返す', async () => {
            (prisma.cellRemark.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const req = new NextRequest('http://localhost:3000/api/calendar/cell-remarks');
            const res = await GET(req);

            expect(res.status).toBe(500);
        });
    });

    describe('POST', () => {
        it('認証エラーの場合はエラーレスポンスを返す', async () => {
            const errorResponse = new Response('Unauthorized', { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ error: errorResponse });

            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ foremanId: 'f1', dateKey: '2026-03-12', text: '休出' }),
            });
            const res = await POST(req);

            expect(res).toBe(errorResponse);
        });

        it('必須フィールドが不足している場合は400を返す', async () => {
             const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ foremanId: 'f1' }), // dateKeyがない
            });
            const res = await POST(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.error).toBe('Missing required fields');
        });

        it('テキストが空の場合は削除処理を行いsuccessを返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ foremanId: 'f1', dateKey: '2026-03-12', text: '' }),
            });

            (prisma.cellRemark.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

            const res = await POST(req);
            const data = await res.json();

            expect(prisma.cellRemark.deleteMany).toHaveBeenCalledWith({
                where: { foremanId: 'f1', dateKey: '2026-03-12' },
            });
            expect(data).toEqual({ success: true, deleted: true });
        });

        it('テキストが与えられた場合はupsertし結果を返す', async () => {
            const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ foremanId: 'f1', dateKey: '2026-03-12', text: '早出' }),
            });

            const mockUpserted = { foremanId: 'f1', dateKey: '2026-03-12', text: '早出' };
            (prisma.cellRemark.upsert as jest.Mock).mockResolvedValue(mockUpserted);

            const res = await POST(req);
            const data = await res.json();

            expect(prisma.cellRemark.upsert).toHaveBeenCalledWith({
                where: { foremanId_dateKey: { foremanId: 'f1', dateKey: '2026-03-12' } },
                update: { text: '早出' },
                create: { foremanId: 'f1', dateKey: '2026-03-12', text: '早出' },
            });
            expect(data).toEqual(mockUpserted);
        });

        it('更新時に例外が発生した場合は500を返す', async () => {
             const req = new NextRequest('http://localhost:3000', {
                method: 'POST',
                body: JSON.stringify({ foremanId: 'f1', dateKey: '2026-03-12', text: '早出' }),
            });

            (prisma.cellRemark.upsert as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const res = await POST(req);

            expect(res.status).toBe(500);
        });
    });
});
