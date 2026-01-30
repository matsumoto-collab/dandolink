import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

describe('rate-limit', () => {
    describe('checkRateLimit', () => {
        it('should allow first request', () => {
            const result = checkRateLimit('test-user-1', { limit: 5, windowMs: 1000 });
            expect(result.success).toBe(true);
            expect(result.remaining).toBe(4);
        });

        it('should track multiple requests', () => {
            const identifier = 'test-user-2';
            const config = { limit: 3, windowMs: 10000 };

            const result1 = checkRateLimit(identifier, config);
            expect(result1.success).toBe(true);
            expect(result1.remaining).toBe(2);

            const result2 = checkRateLimit(identifier, config);
            expect(result2.success).toBe(true);
            expect(result2.remaining).toBe(1);

            const result3 = checkRateLimit(identifier, config);
            expect(result3.success).toBe(true);
            expect(result3.remaining).toBe(0);
        });

        it('should reject when limit exceeded', () => {
            const identifier = 'test-user-3';
            const config = { limit: 2, windowMs: 10000 };

            checkRateLimit(identifier, config);
            checkRateLimit(identifier, config);

            const result = checkRateLimit(identifier, config);
            expect(result.success).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should use default config when not provided', () => {
            const result = checkRateLimit('test-user-4');
            expect(result.success).toBe(true);
            expect(result.limit).toBe(100);
        });

        it('should track different identifiers separately', () => {
            const config = { limit: 1, windowMs: 10000 };

            const result1 = checkRateLimit('user-a', config);
            expect(result1.success).toBe(true);

            const result2 = checkRateLimit('user-b', config);
            expect(result2.success).toBe(true);

            const result3 = checkRateLimit('user-a', config);
            expect(result3.success).toBe(false);
        });

        it('should return correct limit value', () => {
            const config = { limit: 50, windowMs: 1000 };
            const result = checkRateLimit('test-user-5', config);
            expect(result.limit).toBe(50);
        });

        it('should return resetTime in the future', () => {
            const now = Date.now();
            const config = { limit: 10, windowMs: 5000 };
            const result = checkRateLimit('test-user-6', config);
            expect(result.resetTime).toBeGreaterThan(now);
            expect(result.resetTime).toBeLessThanOrEqual(now + 5000);
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
