import { parseWalTimestamp } from '@/lib/walTimestamp';

describe('parseWalTimestamp', () => {
    it('タイムゾーン表記なし（WALのtimestamp列）はUTCとして解釈する', () => {
        expect(parseWalTimestamp('2026-07-07T15:00:00').toISOString()).toBe('2026-07-07T15:00:00.000Z');
    });

    it('ミリ秒付きもUTCとして解釈する', () => {
        expect(parseWalTimestamp('2026-07-07T15:00:00.123').toISOString()).toBe('2026-07-07T15:00:00.123Z');
    });

    it('スペース区切りはTに正規化してUTCとして解釈する', () => {
        expect(parseWalTimestamp('2026-07-07 15:00:00').toISOString()).toBe('2026-07-07T15:00:00.000Z');
    });

    it('Z付きはそのまま解釈する', () => {
        expect(parseWalTimestamp('2026-07-07T15:00:00Z').toISOString()).toBe('2026-07-07T15:00:00.000Z');
    });

    it('オフセット付きはそのまま解釈する', () => {
        expect(parseWalTimestamp('2026-07-08T00:00:00+09:00').toISOString()).toBe('2026-07-07T15:00:00.000Z');
        expect(parseWalTimestamp('2026-07-08T00:00:00+0900').toISOString()).toBe('2026-07-07T15:00:00.000Z');
    });

    it('日付のみはUTC 0時として解釈する（ES仕様どおり）', () => {
        expect(parseWalTimestamp('2026-07-07').toISOString()).toBe('2026-07-07T00:00:00.000Z');
    });
});
