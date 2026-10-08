import { buildWatchParam, parseWatchParam, MAX_WATCH_NAV_ITEMS } from '@/lib/scheduleWatchNav';

describe('scheduleWatchNav', () => {
    it('build → parse で往復できる（label は URL に載せない）', () => {
        const items = [
            { assignmentId: 'abc-123', date: '2026-10-09', label: '浮き' },
            { assignmentId: 'cuid_with_underscore', date: '2026-10-12' },
        ];
        const raw = buildWatchParam(items);
        expect(raw).toBe('2026-10-09_abc-123,2026-10-12_cuid_with_underscore');
        expect(parseWatchParam(raw)).toEqual([
            { assignmentId: 'abc-123', date: '2026-10-09' },
            { assignmentId: 'cuid_with_underscore', date: '2026-10-12' },
        ]);
    });

    it('空・null・undefined は空配列', () => {
        expect(parseWatchParam('')).toEqual([]);
        expect(parseWatchParam(null)).toEqual([]);
        expect(parseWatchParam(undefined)).toEqual([]);
    });

    it('形の合わない要素は捨てる', () => {
        const raw = [
            '2026-10-09_ok1',
            'nodate',
            '2026/10/09_bad',
            '2026-10-09_',
            '_noid',
            '',
            '2026-1-9_short',
            '2026-10-10_ok2',
        ].join(',');
        expect(parseWatchParam(raw)).toEqual([
            { assignmentId: 'ok1', date: '2026-10-09' },
            { assignmentId: 'ok2', date: '2026-10-10' },
        ]);
    });

    it('上限を超える分は build でも parse でも切る', () => {
        const many = Array.from({ length: MAX_WATCH_NAV_ITEMS + 5 }, (_, i) => ({
            assignmentId: `id${i}`,
            date: '2026-10-09',
        }));
        const raw = buildWatchParam(many);
        expect(raw.split(',')).toHaveLength(MAX_WATCH_NAV_ITEMS);
        const longRaw = many.map((i) => `${i.date}_${i.assignmentId}`).join(',');
        const parsed = parseWatchParam(longRaw);
        expect(parsed).toHaveLength(MAX_WATCH_NAV_ITEMS);
        expect(parsed[0].assignmentId).toBe('id0');
    });
});
