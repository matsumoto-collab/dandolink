/**
 * lib/api/utils.ts のテスト
 * エラーレスポンス、バリデーション、JSON処理のテスト
 */

jest.unmock('@/lib/api/utils');

import { NextResponse, NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// NextResponseをモック
jest.mock('next/server', () => ({
    NextResponse: {
        json: jest.fn((data, init) => ({ data, init })),
    },
    NextRequest: jest.fn(),
}));

// next-authをモック
jest.mock('next-auth', () => ({
    getServerSession: jest.fn(),
}));

// authOptionsをモック
jest.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// rate-limitをモック
jest.mock('@/lib/rate-limit', () => ({
    checkRateLimit: jest.fn(),
    RATE_LIMITS: { api: { maxRequests: 100, windowMs: 60000 } },
}));

import { getServerSession } from 'next-auth';
import { checkRateLimit } from '@/lib/rate-limit';

import {
    requireAuth,
    requireAdmin,
    errorResponse,
    notFoundResponse,
    validationErrorResponse,
    serverErrorResponse,
    successResponse,
    deleteSuccessResponse,
    applyRateLimit,
    parseJsonField,
    stringifyJsonField,
} from '@/lib/api/utils';

describe('API Utils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('requireAuth', () => {
        it('should return error when no session', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const result = await requireAuth();

            expect(result.session).toBeNull();
            expect(result.error).not.toBeNull();
            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: '認証が必要です' },
                { status: 401 }
            );
        });

        it('should return session when authenticated', async () => {
            const mockSession = { user: { id: 'user-1', role: 'admin' } };
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);

            const result = await requireAuth();

            expect(result.session).toEqual(mockSession);
            expect(result.error).toBeNull();
        });
    });

    describe('requireAdmin', () => {
        it('should return error when not admin', async () => {
            const mockSession = { user: { id: 'user-1', role: 'worker' } };
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);

            const result = await requireAdmin();

            expect(result.session).toBeNull();
            expect(result.error).not.toBeNull();
            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: '管理者権限が必要です' },
                { status: 403 }
            );
        });

        it('should return session when admin', async () => {
            const mockSession = { user: { id: 'user-1', role: 'admin' } };
            (getServerSession as jest.Mock).mockResolvedValue(mockSession);

            const result = await requireAdmin();

            expect(result.session).toEqual(mockSession);
            expect(result.error).toBeNull();
        });
    });

    describe('errorResponse', () => {
        it('should create 500 error by default', () => {
            errorResponse('エラーメッセージ');

            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: 'エラーメッセージ' },
                { status: 500 }
            );
        });

        it('should create error with specified status', () => {
            errorResponse('バリデーションエラー', 400);

            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: 'バリデーションエラー' },
                { status: 400 }
            );
        });
    });

    describe('notFoundResponse', () => {
        it('should create 404 response with resource name', () => {
            notFoundResponse('ユーザー');

            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: 'ユーザーが見つかりません' },
                { status: 404 }
            );
        });
    });

    describe('validationErrorResponse', () => {
        it('should create 400 response with message', () => {
            validationErrorResponse('入力エラー');

            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: '入力エラー', details: undefined },
                { status: 400 }
            );
        });

        it('should include details when provided', () => {
            const details = [{ path: ['email'], message: '無効なメール' }];
            validationErrorResponse('入力エラー', details);

            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: '入力エラー', details },
                { status: 400 }
            );
        });
    });

    describe('serverErrorResponse', () => {
        beforeEach(() => {
            // console.errorをモック
            jest.spyOn(console, 'error').mockImplementation(() => { });
        });

        afterEach(() => {
            (console.error as jest.Mock).mockRestore();
        });

        it('should log error and return 500 for generic errors', () => {
            const error = new Error('Something went wrong');
            serverErrorResponse('データ取得', error);

            expect(console.error).toHaveBeenCalled();
            expect(NextResponse.json).toHaveBeenCalledWith(
                { error: 'データ取得に失敗しました' },
                { status: 500 }
            );
        });

        it('should handle Prisma unique constraint error (P2002)', () => {
            const error = new Prisma.PrismaClientKnownRequestError(
                'Unique constraint failed',
                { code: 'P2002', clientVersion: '5.0.0' }
            );
            serverErrorResponse('ユーザー作成', error);

            expect(NextResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('同じデータが既に存在します'),
                    code: 'P2002',
                }),
                { status: 400 }
            );
        });

        it('should handle Prisma foreign key error (P2003)', () => {
            const error = new Prisma.PrismaClientKnownRequestError(
                'Foreign key constraint failed',
                { code: 'P2003', clientVersion: '5.0.0' }
            );
            serverErrorResponse('配置作成', error);

            expect(NextResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('関連するデータが存在しないか'),
                    code: 'P2003',
                }),
                { status: 400 }
            );
        });

        it('should handle Prisma not found error (P2025)', () => {
            const error = new Prisma.PrismaClientKnownRequestError(
                'Record not found',
                { code: 'P2025', clientVersion: '5.0.0' }
            );
            serverErrorResponse('案件削除', error);

            expect(NextResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('対象のデータが見つかりません'),
                    code: 'P2025',
                }),
                { status: 404 }
            );
        });

        it('should handle Prisma validation error', () => {
            const error = new Prisma.PrismaClientValidationError(
                'Invalid input',
                { clientVersion: '5.0.0' }
            );
            serverErrorResponse('データ更新', error);

            expect(NextResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('入力データが不正です'),
                }),
                { status: 400 }
            );
        });
    });

    describe('successResponse', () => {
        it('should return data without cache headers by default', () => {
            successResponse({ id: '1', name: 'Test' });

            expect(NextResponse.json).toHaveBeenCalledWith(
                { id: '1', name: 'Test' },
                { headers: {} }
            );
        });

        it('should include cache headers when specified', () => {
            successResponse({ id: '1' }, { cacheMaxAge: 300 });

            expect(NextResponse.json).toHaveBeenCalledWith(
                { id: '1' },
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Cache-Control': expect.stringContaining('max-age=300'),
                    }),
                })
            );
        });
    });

    describe('deleteSuccessResponse', () => {
        it('should return success message with resource name', () => {
            deleteSuccessResponse('案件');

            expect(NextResponse.json).toHaveBeenCalledWith({
                message: '案件を削除しました',
            });
        });
    });

    describe('applyRateLimit', () => {
        it('should return null when rate limit not exceeded', () => {
            (checkRateLimit as jest.Mock).mockReturnValue({
                success: true,
                remaining: 99,
            });

            const mockReq = {
                headers: { get: jest.fn().mockReturnValue('127.0.0.1') },
            } as unknown as NextRequest;

            const result = applyRateLimit(mockReq);

            expect(result).toBeNull();
        });

        it('should return 429 response when rate limit exceeded', () => {
            (checkRateLimit as jest.Mock).mockReturnValue({
                success: false,
                limit: 100,
                resetTime: Date.now() + 60000,
            });

            const mockReq = {
                headers: { get: jest.fn().mockReturnValue('127.0.0.1') },
            } as unknown as NextRequest;

            applyRateLimit(mockReq);

            expect(NextResponse.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('リクエスト数が上限を超えました'),
                }),
                expect.objectContaining({ status: 429 })
            );
        });
    });

    describe('JSON処理関数', () => {
        describe('parseJsonField', () => {
            it('should parse valid JSON string', () => {
                const result = parseJsonField('["a","b","c"]', []);
                expect(result).toEqual(['a', 'b', 'c']);
            });

            it('should return default for null', () => {
                const result = parseJsonField(null, ['default']);
                expect(result).toEqual(['default']);
            });

            it('should return default for invalid JSON', () => {
                const result = parseJsonField('not json', []);
                expect(result).toEqual([]);
            });

            it('should return default for undefined', () => {
                const result = parseJsonField(undefined, { key: 'value' });
                expect(result).toEqual({ key: 'value' });
            });
        });

        describe('stringifyJsonField', () => {
            it('should stringify arrays', () => {
                const result = stringifyJsonField(['a', 'b']);
                expect(result).toBe('["a","b"]');
            });

            it('should stringify objects', () => {
                const result = stringifyJsonField({ key: 'value' });
                expect(result).toBe('{"key":"value"}');
            });

            it('should return null for null input', () => {
                const result = stringifyJsonField(null);
                expect(result).toBeNull();
            });

            it('should return null for undefined input', () => {
                const result = stringifyJsonField(undefined);
                expect(result).toBeNull();
            });
        });
    });
});
