// Set dummy Supabase env vars for CI (where .env is not available)
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

// Set dummy Upstash env vars so lib/rate-limit.ts initializes redis in tests
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://mock.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'mock-token';

import '@testing-library/jest-dom';
import React from 'react';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill TextEncoder/TextDecoder for Next.js
Object.assign(global, { TextEncoder, TextDecoder });

// Mock browser APIs not available in Node.js
global.alert = jest.fn();
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
global.URL.revokeObjectURL = jest.fn();


// グローバルなモックの設定
// Next.js Image コンポーネントのモック
jest.mock('next/image', () => ({
    __esModule: true,
    default: function MockImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
        return React.createElement('img', { ...props, alt: props.alt || '' });
    },
}));

// Next.js Router のモック
jest.mock('next/navigation', () => ({
    useRouter() {
        return {
            push: jest.fn(),
            replace: jest.fn(),
            back: jest.fn(),
            forward: jest.fn(),
            prefetch: jest.fn(),
            refresh: jest.fn(),
        };
    },
    usePathname() {
        return '/';
    },
    useSearchParams() {
        return new URLSearchParams();
    },
}));

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({
        data: { user: { name: 'Test User', email: 'test@example.com' } },
        status: 'authenticated',
    })),
    SessionProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

// window.matchMedia のモック
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });

    // ResizeObserver のモック (Node環境では不要)
    global.ResizeObserver = class ResizeObserver {
        observe() { }
        unobserve() { }
        disconnect() { }
    };
}

// Global Mocks for API Testing
// These mocks are applied to all tests, but can be overridden in individual test files using jest.mock()

// Mock fetch globally
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
    })
) as jest.Mock;

// Mock @/lib/prisma
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        projectAssignment: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
            count: jest.fn(),
        },
        customer: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        invoiceProjectMaster: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        billingTitle: {
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            aggregate: jest.fn(),
        },
        estimate: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        dailyReport: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
            upsert: jest.fn(),
        },
        dailyReportWorkItem: {
            createMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        // Mock $transaction to execute the callback immediately
        $transaction: jest.fn((callback) => callback(require('@/lib/prisma').prisma)),
    },
}));

// Mock @/lib/api/utils
jest.mock('@/lib/api/utils', () => {
    // Requires inside factory to avoid hoisting issues
    const { NextResponse } = require('next/server');
    return {
        requireAuth: jest.fn().mockResolvedValue({
            session: { user: { id: 'user-1', role: 'manager', isActive: true } },
            error: null
        }),
        requireManagerOrAbove: jest.fn().mockResolvedValue({
            session: { user: { id: 'user-1', role: 'manager', isActive: true } },
            error: null
        }),
        applyRateLimit: jest.fn().mockReturnValue(null),
        RATE_LIMITS: { api: { limit: 100, window: 60 } },
        stringifyJsonField: (val: any) => JSON.stringify(val),
        parseJsonField: (val: any, fallback: any) => val ? JSON.parse(val) : fallback,
        errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
        serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
        validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: 'Validation Error', details: details || msg }, { status: 400 })),
        successResponse: jest.fn().mockImplementation((data) => NextResponse.json(data)),
        deleteSuccessResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ message: msg })),
        notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    };
});

// Mock @/utils/permissions
jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn().mockReturnValue(true),
    hasPermission: jest.fn().mockReturnValue(true),
    isAdmin: jest.fn().mockReturnValue(true),
    isManagerOrAbove: jest.fn().mockReturnValue(true),
    canAccessProject: jest.fn().mockReturnValue(true),
    canManageUsers: jest.fn().mockReturnValue(true),
}));

// Mock @/lib/formatters
jest.mock('@/lib/formatters', () => ({
    formatProjectMaster: (item: any) => ({ ...item, createdAt: item.createdAt?.toISOString?.() || item.createdAt, updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt }),
    formatAssignment: (item: any) => ({ ...item, createdAt: item.createdAt?.toISOString?.() || item.createdAt, updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt }),
    formatEstimate: (item: any) => ({ ...item, createdAt: item.createdAt?.toISOString?.() || item.createdAt, updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt }),
    formatInvoice: (item: any) => ({ ...item, createdAt: item.createdAt?.toISOString?.() || item.createdAt, updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt }),
    formatUser: (item: any) => item,
    formatCustomer: (item: any) => item,
}));

// Mock lucide-react to avoid ESM transform issues in Jest
// All icons are mocked as simple div elements with a data-testid
jest.mock('lucide-react', () => {
    const React = require('react');
    const createIcon = (name: string) =>
        function MockIcon(props: React.SVGProps<SVGSVGElement>) {
            return React.createElement('svg', { 'data-testid': `icon-${name}`, ...props });
        };

    return new Proxy({}, {
        get(_target, prop: string) {
            return createIcon(prop);
        }
    });
});

// Mock uuid (ESM-only package that Jest cannot transform)
jest.mock('uuid', () => ({
    v4: () => 'mock-uuid-' + Math.random().toString(36).substring(2, 9),
    v1: () => 'mock-uuid-v1',
    NIL: '00000000-0000-0000-0000-000000000000',
    validate: (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));

// Mock NotoSansJP font (large base64 file - not needed in tests)
jest.mock('@/utils/fonts/NotoSansJP-font', () => ({
    NotoSansJPFont: 'mock-font-data',
}));
