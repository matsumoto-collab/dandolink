// In-memory counts shared across mock Ratelimit instances
const mockCounts = new Map<string, number>();

// Mock @upstash/redis so Redis constructor succeeds without real credentials
jest.mock('@upstash/redis', () => ({
    Redis: jest.fn().mockImplementation(() => ({})),
}));

// Mock @upstash/ratelimit with an in-memory sliding-window implementation for tests
jest.mock('@upstash/ratelimit', () => {
    const slidingWindow = (limit: number, window: string) => {
        const windowSec = parseInt(window, 10);
        return { _limit: limit, _windowMs: windowSec * 1000 };
    };

    function MockRatelimit({ limiter }: { limiter: { _limit: number; _windowMs: number } }) {
        const limit = limiter._limit;
        const windowMs = limiter._windowMs;
        return {
            limit: async (identifier: string) => {
                const count = (mockCounts.get(identifier) ?? 0) + 1;
                mockCounts.set(identifier, count);
                const success = count <= limit;
                return {
                    success,
                    limit,
                    remaining: Math.max(0, limit - count),
                    reset: Date.now() + windowMs,
                };
            },
        };
    }
    (MockRatelimit as any).slidingWindow = slidingWindow;

    return { Ratelimit: MockRatelimit };
});

import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

beforeEach(() => {
    mockCounts.clear();
});

describe('rate-limit', () => {
    describe('checkRateLimit', () => {
        it('should allow first request', async () => {
            const result = await checkRateLimit('test-user-1', { limit: 5, windowMs: 1000 });
            expect(result.success).toBe(true);
            expect(result.remaining).toBe(4);
        });

        it('should track multiple requests', async () => {
            const identifier = 'test-user-2';
            const config = { limit: 3, windowMs: 10000 };

            const result1 = await checkRateLimit(identifier, config);
            expect(result1.success).toBe(true);
            expect(result1.remaining).toBe(2);

            const result2 = await checkRateLimit(identifier, config);
            expect(result2.success).toBe(true);
            expect(result2.remaining).toBe(1);

            const result3 = await checkRateLimit(identifier, config);
            expect(result3.success).toBe(true);
            expect(result3.remaining).toBe(0);
        });

        it('should reject when limit exceeded', async () => {
            const identifier = 'test-user-3';
            const config = { limit: 2, windowMs: 10000 };

            await checkRateLimit(identifier, config);
            await checkRateLimit(identifier, config);

            const result = await checkRateLimit(identifier, config);
            expect(result.success).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should use default config when not provided', async () => {
            const result = await checkRateLimit('test-user-4');
            expect(result.success).toBe(true);
            expect(result.limit).toBe(100);
        });

        it('should track different identifiers separately', async () => {
            const config = { limit: 1, windowMs: 10000 };

            const result1 = await checkRateLimit('user-a', config);
            expect(result1.success).toBe(true);

            const result2 = await checkRateLimit('user-b', config);
            expect(result2.success).toBe(true);

            const result3 = await checkRateLimit('user-a', config);
            expect(result3.success).toBe(false);
        });

        it('should return correct limit value', async () => {
            const config = { limit: 50, windowMs: 1000 };
            const result = await checkRateLimit('test-user-5', config);
            expect(result.limit).toBe(50);
        });

        it('should return resetTime in the future', async () => {
            const now = Date.now();
            const config = { limit: 10, windowMs: 5000 };
            const result = await checkRateLimit('test-user-6', config);
            expect(result.resetTime).toBeGreaterThan(now);
            expect(result.resetTime).toBeLessThanOrEqual(now + 5000 + 100);
        });
    });

    describe('RATE_LIMITS presets', () => {
        it('should have api preset', () => {
            expect(RATE_LIMITS.api.limit).toBe(100);
            expect(RATE_LIMITS.api.windowMs).toBe(60000);
        });

        it('should have auth preset', () => {
            expect(RATE_LIMITS.auth.limit).toBe(10);
            expect(RATE_LIMITS.auth.windowMs).toBe(60000);
        });

        it('should have heavy preset', () => {
            expect(RATE_LIMITS.heavy.limit).toBe(20);
            expect(RATE_LIMITS.heavy.windowMs).toBe(60000);
        });
    });
});
