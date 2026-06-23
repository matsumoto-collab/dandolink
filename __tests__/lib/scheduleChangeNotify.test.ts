import {
    dateKeyJst,
    jstWindowKeys,
    isWithinNotifyWindow,
    buildScheduleChangeMessage,
} from '@/lib/scheduleChangeNotify';

describe('dateKeyJst', () => {
    it('JST 0時保存(前日T15:00:00Z)は当日のJST日キー', () => {
        expect(dateKeyJst(new Date('2026-06-22T15:00:00.000Z'))).toBe('2026-06-23');
    });
    it('UTC 0時保存(T00:00:00Z)も同じJST日キー', () => {
        expect(dateKeyJst(new Date('2026-06-23T00:00:00.000Z'))).toBe('2026-06-23');
    });
    it('JST昼間の絶対時刻も同じJST日', () => {
        expect(dateKeyJst(new Date('2026-06-23T08:30:00.000Z'))).toBe('2026-06-23');
    });
});

describe('jstWindowKeys', () => {
    it('今日〜7日後のJST日キー（JST昼）', () => {
        const now = new Date('2026-06-23T03:00:00.000Z'); // JST 6/23 12:00
        expect(jstWindowKeys(now)).toEqual({ fromKey: '2026-06-23', toKey: '2026-06-30' });
    });
    it('JST深夜0時境界(前日T15:00Z)', () => {
        const now = new Date('2026-06-22T15:00:00.000Z'); // JST 6/23 00:00
        expect(jstWindowKeys(now)).toEqual({ fromKey: '2026-06-23', toKey: '2026-06-30' });
    });
    it('月跨ぎ', () => {
        const now = new Date('2026-06-28T03:00:00.000Z'); // JST 6/28
        expect(jstWindowKeys(now)).toEqual({ fromKey: '2026-06-28', toKey: '2026-07-05' });
    });
});

describe('isWithinNotifyWindow', () => {
    const now = new Date('2026-06-23T03:00:00.000Z'); // JST 6/23、窓=6/23〜6/30

    it('今日は窓内', () => {
        expect(isWithinNotifyWindow(new Date('2026-06-23T00:00:00.000Z'), null, now)).toBe(true);
    });
    it('7日後(6/30)は窓内', () => {
        expect(isWithinNotifyWindow(new Date('2026-06-30T00:00:00.000Z'), null, now)).toBe(true);
    });
    it('8日後(7/1)は窓外', () => {
        expect(isWithinNotifyWindow(new Date('2026-07-01T00:00:00.000Z'), null, now)).toBe(false);
    });
    it('昨日は窓外', () => {
        expect(isWithinNotifyWindow(new Date('2026-06-22T00:00:00.000Z'), null, now)).toBe(false);
    });
    it('移動元のみ窓内なら通知（直近の予定が動く）', () => {
        expect(
            isWithinNotifyWindow(
                new Date('2026-06-24T00:00:00.000Z'),
                new Date('2026-07-20T00:00:00.000Z'),
                now,
            ),
        ).toBe(true);
    });
    it('移動先のみ窓内なら通知（遠い予定が直近へ来る）', () => {
        expect(
            isWithinNotifyWindow(
                new Date('2026-05-01T00:00:00.000Z'),
                new Date('2026-06-25T00:00:00.000Z'),
                now,
            ),
        ).toBe(true);
    });
    it('両方窓外は通知しない', () => {
        expect(
            isWithinNotifyWindow(
                new Date('2026-05-01T00:00:00.000Z'),
                new Date('2026-08-01T00:00:00.000Z'),
                now,
            ),
        ).toBe(false);
    });
    it('両方nullは通知しない', () => {
        expect(isWithinNotifyWindow(null, null, now)).toBe(false);
    });
    it('Invalid Date は窓外扱い（例外を投げない）', () => {
        expect(isWithinNotifyWindow(new Date('invalid'), null, now)).toBe(false);
    });
    it('ISO文字列の日付も扱える（防御）', () => {
        expect(isWithinNotifyWindow('2026-06-25T00:00:00.000Z' as unknown as Date, null, now)).toBe(true);
        expect(isWithinNotifyWindow('2026-08-01T00:00:00.000Z' as unknown as Date, null, now)).toBe(false);
    });
    it('JST深夜境界: 前日T15:00Z保存の今日分は窓内', () => {
        const nowMidnight = new Date('2026-06-22T15:00:00.000Z'); // JST 6/23 0:00
        expect(isWithinNotifyWindow(new Date('2026-06-22T15:00:00.000Z'), null, nowMidnight)).toBe(true);
    });
});

describe('buildScheduleChangeMessage', () => {
    const d = (iso: string) => new Date(iso);

    it('moved: タイトルと矢印・接頭辞', () => {
        const r = buildScheduleChangeMessage({
            kind: 'moved',
            siteName: 'A現場',
            fromDate: d('2026-06-24T00:00:00.000Z'),
            toDate: d('2026-06-26T00:00:00.000Z'),
        });
        expect(r.title).toBe('【予定変更】A現場');
        expect(r.body).toContain('→');
        expect(r.body.startsWith('日程変更:')).toBe(true);
    });

    it('suffix付きは括弧で連結', () => {
        const r = buildScheduleChangeMessage({
            kind: 'moved',
            siteName: 'A現場',
            suffix: '組立',
            fromDate: d('2026-06-24T00:00:00.000Z'),
            toDate: d('2026-06-26T00:00:00.000Z'),
        });
        expect(r.title).toBe('【予定変更】A現場（組立）');
    });

    it('reassigned-in: 担当になった', () => {
        const r = buildScheduleChangeMessage({
            kind: 'reassigned-in',
            siteName: 'A現場',
            toDate: d('2026-06-24T00:00:00.000Z'),
        });
        expect(r.title).toBe('【担当変更】A現場');
        expect(r.body).toContain('担当になりました');
    });

    it('reassigned-out: 新職長名を併記', () => {
        const r = buildScheduleChangeMessage({
            kind: 'reassigned-out',
            siteName: 'A現場',
            toDate: d('2026-06-24T00:00:00.000Z'),
            otherForemanName: '山田',
        });
        expect(r.title).toBe('【担当変更】A現場');
        expect(r.body).toContain('外れました');
        expect(r.body).toContain('山田');
    });

    it('reassigned-out: 名前なしでも壊れない（矢印なし）', () => {
        const r = buildScheduleChangeMessage({
            kind: 'reassigned-out',
            siteName: 'A現場',
            toDate: d('2026-06-24T00:00:00.000Z'),
        });
        expect(r.body).toContain('外れました');
        expect(r.body).not.toContain('→');
    });

    it('deleted', () => {
        const r = buildScheduleChangeMessage({
            kind: 'deleted',
            siteName: 'A現場',
            toDate: d('2026-06-24T00:00:00.000Z'),
        });
        expect(r.title).toBe('【予定削除】A現場');
        expect(r.body).toContain('削除されました');
    });

    it('created 単数', () => {
        const r = buildScheduleChangeMessage({
            kind: 'created',
            siteName: 'A現場',
            toDate: d('2026-06-24T00:00:00.000Z'),
            createdCount: 1,
        });
        expect(r.title).toBe('【新規予定】A現場');
        expect(r.body).toContain('追加されました');
        expect(r.body).not.toContain('件');
    });

    it('created 複数は集約表記（ほか・件数・範囲）', () => {
        const r = buildScheduleChangeMessage({
            kind: 'created',
            siteName: 'A現場',
            fromDate: d('2026-06-24T00:00:00.000Z'),
            toDate: d('2026-06-28T00:00:00.000Z'),
            createdCount: 3,
        });
        expect(r.title).toBe('【新規予定】A現場 ほか');
        expect(r.body).toContain('3件');
        expect(r.body).toContain('〜');
    });
});
