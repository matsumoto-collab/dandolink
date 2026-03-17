import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '@/app/api/project-masters/[id]/files/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: { findUnique: jest.fn() },
        projectMasterFile: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    },
}));

const mockCreateSignedUrl = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: {
        storage: {
            from: jest.fn(() => ({
                createSignedUrl: mockCreateSignedUrl,
                upload: mockUpload,
                remove: mockRemove,
            })),
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

jest.mock('crypto', () => ({
    randomUUID: jest.fn().mockReturnValue('mock-uuid'),
}));

jest.mock('sharp', () => {
    const mockSharp = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-webp-buffer')),
    };
    return jest.fn(() => mockSharp);
});

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

class MockFormData {
    private data = new Map();
    append(key: string, value: any) { this.data.set(key, value); }
    get(key: string) { return this.data.get(key) || null; }
}

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
            _formData: Map<string, any>;
            constructor(url: string, init?: any) {
                this.url = url;
                this.method = init?.method || 'GET';
                this._formData = init?._formData || new Map();
            }
            async formData() {
                const fd = new MockFormData();
                for (const [k, v] of this._formData.entries()) {
                    fd.append(k, v);
                }
                return fd;
            }
        },
        NextResponse: MockNextResponse
    };
});

describe('/api/project-masters/[id]/files', () => {
    const mockSession = { user: { role: 'admin', id: 'user-1' } };
    const mockContext = { params: Promise.resolve({ id: 'pm-1' }) };

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
        (mockCreateSignedUrl as jest.Mock).mockResolvedValue({ data: { signedUrl: 'http://new-signed-url' }, error: null });
    });

    describe('GET', () => {
        it('案件が見つからない場合は404を返す', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);
            
            const req = new NextRequest('http://localhost:3000/api', { method: 'GET' });
            const res = await GET(req, mockContext) as any;
            
            expect(res.status).toBe(404);
        });

        it('ファイルの署名付きURLが既に有効であればそのまま返す', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });
            
            const futureDate = new Date();
            futureDate.setHours(futureDate.getHours() + 1);

            const mockFiles = [
                {
                    id: 'f-1',
                    storagePath: 'pm-1/f-1',
                    signedUrl: 'http://old-url',
                    signedUrlExpiresAt: futureDate,
                }
            ];
            (prisma.projectMasterFile.findMany as jest.Mock).mockResolvedValue(mockFiles);

            const req = new NextRequest('http://localhost:3000/api', { method: 'GET' });
            const res = await GET(req, mockContext) as any;
            const data = await res.json();

            expect(data[0].signedUrl).toBe('http://old-url');
            expect(mockCreateSignedUrl).not.toHaveBeenCalled();
            expect(prisma.projectMasterFile.update).not.toHaveBeenCalled();
        });

        it('ファイルの署名付きURLが期限切れなら再生成して返す', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });
            
            const pastDate = new Date();
            pastDate.setMinutes(pastDate.getMinutes() - 1);

            const mockFiles = [
                {
                    id: 'f-1',
                    storagePath: 'pm-1/f-1',
                    signedUrl: 'http://old-url',
                    signedUrlExpiresAt: pastDate,
                }
            ];
            (prisma.projectMasterFile.findMany as jest.Mock).mockResolvedValue(mockFiles);

            const req = new NextRequest('http://localhost:3000/api', { method: 'GET' });
            const res = await GET(req, mockContext) as any;
            const data = await res.json();

            expect(data[0].signedUrl).toBe('http://new-signed-url');
            expect(mockCreateSignedUrl).toHaveBeenCalledWith('pm-1/f-1', 3600);
            expect(prisma.projectMasterFile.update).toHaveBeenCalled();
        });
    });

    describe('POST', () => {
        it('権限がない場合は403を返す', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api', { method: 'POST' });
            const res = await POST(req, mockContext) as any;

            expect(res.status).toBe(403);
        });

        it('ファイルがない場合は400を返す', async () => {
             (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });

             const req = new NextRequest('http://localhost:3000/api', {
                method: 'POST',
                _formData: new Map(), // Empty formData
             } as any);
             const res = await POST(req, mockContext) as any;

             expect(res.status).toBe(400);
        });

        it('不正なMIMEタイプの場合は400を返す', async () => {
             (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });

             const fd = new Map();
             fd.set('file', { type: 'text/plain', size: 100 });

             const req = new NextRequest('http://localhost:3000/api', {
                method: 'POST',
                _formData: fd,
             } as any);
             const res = await POST(req, mockContext) as any;

             expect(res.status).toBe(400);
        });

        it('正常に画像をアップロードして処理する', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });

            const mockFile = {
                type: 'image/jpeg',
                size: 1000,
                name: 'test.jpg',
                arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10)),
            };

            const fd = new Map();
            fd.set('file', mockFile);
            fd.set('description', 'test img');
            fd.set('category', 'survey');

            const req = new NextRequest('http://localhost:3000/api', {
                method: 'POST',
                _formData: fd,
            } as any);

            (mockUpload as jest.Mock).mockResolvedValue({ data: { path: 'pm-1/mock-uuid.webp' }, error: null });
            (mockCreateSignedUrl as jest.Mock).mockResolvedValue({ data: { signedUrl: 'http://signed' } });
            (prisma.projectMasterFile.create as jest.Mock).mockResolvedValue({ id: 'mock-uuid', fileName: 'test.jpg' });

            const res = await POST(req, mockContext) as any;
            const data = await res.json();

            expect(mockUpload).toHaveBeenCalledTimes(3); // original, display, and thumbnail
            expect(prisma.projectMasterFile.create).toHaveBeenCalled();
            expect(res.status).toBe(201);
            expect(data.fileName).toBe('test.jpg');
        });

        it('正常にPDFをアップロードして処理する', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: 'pm-1' });

            const mockFile = {
                type: 'application/pdf',
                size: 1000,
                name: 'doc.pdf',
                arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10)),
            };

            const fd = new Map();
            fd.set('file', mockFile);

            const req = new NextRequest('http://localhost:3000/api', {
                method: 'POST',
                _formData: fd,
            } as any);

            (mockUpload as jest.Mock).mockResolvedValue({ data: { path: 'pm-1/mock-uuid.pdf' }, error: null });
            (mockCreateSignedUrl as jest.Mock).mockResolvedValue({ data: { signedUrl: 'http://signed' } });
            (prisma.projectMasterFile.create as jest.Mock).mockResolvedValue({ id: 'mock-uuid', fileName: 'doc.pdf' });

            const res = await POST(req, mockContext) as any;

            expect(mockUpload).toHaveBeenCalledTimes(1); // PDF does not have thumbnail
            expect(prisma.projectMasterFile.create).toHaveBeenCalled();
            expect(res.status).toBe(201);
        });
    });
});
