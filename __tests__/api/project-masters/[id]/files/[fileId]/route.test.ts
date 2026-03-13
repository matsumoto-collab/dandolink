import { NextRequest, NextResponse } from 'next/server';
import { DELETE } from '@/app/api/project-masters/[id]/files/[fileId]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMasterFile: { findFirst: jest.fn(), delete: jest.fn() },
    },
}));

const mockStorageBucket = {
    remove: jest.fn(),
};
jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: {
        storage: {
            from: jest.fn().mockReturnValue(mockStorageBucket),
        },
    },
    STORAGE_BUCKET: 'test-bucket',
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((_msg, _err) => {
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }),
    validationErrorResponse: jest.fn(),
    errorResponse: jest.fn(),
    notFoundResponse: jest.fn(),
}));

jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn(),
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
            constructor(url: string, init?: any) {
                this.url = url;
                this.method = init?.method || 'GET';
            }
        },
        NextResponse: MockNextResponse
    };
});

describe('/api/project-masters/[id]/files/[fileId]', () => {
    const mockSession = { user: { role: 'admin', id: 'user-1' } };
    const mockContext = { params: Promise.resolve({ id: 'pm-1', fileId: 'f-1' }) };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ error: null, session: mockSession });
        (canDispatch as jest.Mock).mockReturnValue(true);
        (errorResponse as jest.Mock).mockImplementation((msg, status) => {
            return NextResponse.json({ error: msg }, { status });
        });
        (notFoundResponse as jest.Mock).mockImplementation((msg) => {
            return NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 });
        });
    });

    describe('DELETE', () => {
        it('権限がない場合は403を返す', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;

            expect(res.status).toBe(403);
        });

        it('ファイルが見つからない場合は404を返す', async () => {
            (prisma.projectMasterFile.findFirst as jest.Mock).mockResolvedValue(null);

            const req = new NextRequest('http://localhost:3000/api', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;

            expect(res.status).toBe(404);
        });

        it('正常にファイルを削除（オリジナルのみ）して返す', async () => {
            const mockFile = {
                id: 'f-1',
                storagePath: 'pm-1/f-1.pdf',
                thumbnailPath: null, // No thumbnail
            };
            (prisma.projectMasterFile.findFirst as jest.Mock).mockResolvedValue(mockFile);
            (mockStorageBucket.remove as jest.Mock).mockResolvedValue({ error: null });
            (prisma.projectMasterFile.delete as jest.Mock).mockResolvedValue(mockFile);

            const req = new NextRequest('http://localhost:3000/api', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;
            const data = await res.json();

            expect(mockStorageBucket.remove).toHaveBeenCalledWith(['pm-1/f-1.pdf']);
            expect(prisma.projectMasterFile.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
        });

        it('正常にファイルを削除（サムネイルあり）して返す', async () => {
            const mockFile = {
                id: 'f-1',
                storagePath: 'pm-1/f-1.webp',
                thumbnailPath: 'pm-1/f-1_thumb.webp',
            };
            (prisma.projectMasterFile.findFirst as jest.Mock).mockResolvedValue(mockFile);
            (mockStorageBucket.remove as jest.Mock).mockResolvedValue({ error: null });
            (prisma.projectMasterFile.delete as jest.Mock).mockResolvedValue(mockFile);

            const req = new NextRequest('http://localhost:3000/api', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;
            const data = await res.json();

            expect(mockStorageBucket.remove).toHaveBeenCalledWith(['pm-1/f-1.webp', 'pm-1/f-1_thumb.webp']);
            expect(prisma.projectMasterFile.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
        });

        it('Storageの削除に失敗してもDBレコードは削除する', async () => {
            const mockFile = {
                id: 'f-1',
                storagePath: 'pm-1/f-1.pdf',
                thumbnailPath: null,
            };
            (prisma.projectMasterFile.findFirst as jest.Mock).mockResolvedValue(mockFile);
            (mockStorageBucket.remove as jest.Mock).mockResolvedValue({ error: new Error('storage error') });
            
            // Should still mock delete to succeed later
            (prisma.projectMasterFile.delete as jest.Mock).mockResolvedValue(mockFile);
            
            // Console error should be called. Ignore it for test output clarity.
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            const req = new NextRequest('http://localhost:3000/api', { method: 'DELETE' });
            const res = await DELETE(req, mockContext) as any;

            expect(mockStorageBucket.remove).toHaveBeenCalled();
            expect(prisma.projectMasterFile.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
            expect(res.status).toBe(200);

            consoleSpy.mockRestore();
        });
    });
});
