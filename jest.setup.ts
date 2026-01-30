import '@testing-library/jest-dom';
import React from 'react';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill TextEncoder/TextDecoder for Next.js
Object.assign(global, { TextEncoder, TextDecoder });

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
