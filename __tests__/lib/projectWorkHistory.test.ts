/**
 * @jest-environment node
 */
import {
    workDateToJstYmd,
    filterWorkHistory,
    matchesWorkHistory,
    hasWorkHistoryFilter,
} from '@/lib/projectWorkHistory';
import type { ProjectWorkHistoryItem } from '@/types/calendar';

/** ProjectAssignment.date は JST0時＝UTC前日15時で保存される。 */
const jstDay = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString();
};

const item = (
    ymd: string,
    constructionType: string | null,
    foremanId: string | null,
): ProjectWorkHistoryItem => ({
    date: jstDay(ymd),
    constructionType,
    foremanId,
    memberCount: 2,
});

// 工事種別ID → 名称（マスタに同名IDが複数ある実データを模す）
const NAMES: Record<string, string> = {
    'ct-assembly-1': '組立',
    'ct-assembly-2': '組立',
    'ct-demolition': '解体',
};
const resolveName = (id: string | null) => (id ? NAMES[id] ?? id : '');

describe('workDateToJstYmd', () => {
    it('UTC前日15時の保存値を JST の当日に直す', () => {
        expect(workDateToJstYmd(jstDay('2026-08-03'))).toBe('2026-08-03');
        expect(workDateToJstYmd(jstDay('2026-01-01'))).toBe('2026-01-01');
        expect(workDateToJstYmd(jstDay('2026-12-31'))).toBe('2026-12-31');
    });

    it('壊れた値は空文字を返す', () => {
        expect(workDateToJstYmd('not-a-date')).toBe('');
    });
});

describe('hasWorkHistoryFilter', () => {
    it('未指定なら false', () => {
        expect(hasWorkHistoryFilter({})).toBe(false);
    });
    it('どれか1つでも指定されていれば true', () => {
        expect(hasWorkHistoryFilter({ from: '2026-08-01' })).toBe(true);
        expect(hasWorkHistoryFilter({ ctypeName: '組立' })).toBe(true);
        expect(hasWorkHistoryFilter({ foremanId: 'u1' })).toBe(true);
    });
});

describe('filterWorkHistory', () => {
    const history = [
        item('2026-07-20', 'ct-assembly-1', 'u-tanaka'),
        item('2026-08-03', 'ct-assembly-2', 'u-suzuki'),
        item('2026-08-05', 'ct-demolition', 'u-tanaka'),
        item('2026-09-10', 'ct-demolition', 'u-suzuki'),
    ];

    it('日付範囲は両端を含む', () => {
        const r = filterWorkHistory(history, { from: '2026-08-03', to: '2026-08-05' }, resolveName);
        expect(r.map((w) => workDateToJstYmd(w.date))).toEqual(['2026-08-03', '2026-08-05']);
    });

    it('from だけ / to だけでも効く', () => {
        expect(filterWorkHistory(history, { from: '2026-08-05' }, resolveName)).toHaveLength(2);
        expect(filterWorkHistory(history, { to: '2026-08-03' }, resolveName)).toHaveLength(2);
    });

    it('工事種別は名称で突き合わせる（同名の別IDもまとめてヒットする）', () => {
        const r = filterWorkHistory(history, { ctypeName: '組立' }, resolveName);
        expect(r.map((w) => w.constructionType)).toEqual(['ct-assembly-1', 'ct-assembly-2']);
    });

    it('職長で絞れる', () => {
        expect(filterWorkHistory(history, { foremanId: 'u-tanaka' }, resolveName)).toHaveLength(2);
    });

    it('複数条件は「同じ1件の作業履歴」がすべて満たすことを求める', () => {
        // 8月内で「田中が組立」→ 8/3は組立だが鈴木、8/5は田中だが解体。該当なし。
        expect(
            filterWorkHistory(
                history,
                { from: '2026-08-01', to: '2026-08-31', ctypeName: '組立', foremanId: 'u-tanaka' },
                resolveName,
            ),
        ).toHaveLength(0);
        // 7月まで広げれば 7/20 の「田中が組立」がヒットする
        expect(
            filterWorkHistory(
                history,
                { from: '2026-07-01', to: '2026-08-31', ctypeName: '組立', foremanId: 'u-tanaka' },
                resolveName,
            ),
        ).toHaveLength(1);
    });

    it('工事種別が未設定の履歴は種別指定で除外される', () => {
        const r = filterWorkHistory([item('2026-08-03', null, 'u1')], { ctypeName: '組立' }, resolveName);
        expect(r).toHaveLength(0);
    });

    it('履歴が無い／undefined なら空配列', () => {
        expect(filterWorkHistory(undefined, { ctypeName: '組立' }, resolveName)).toEqual([]);
        expect(filterWorkHistory([], { ctypeName: '組立' }, resolveName)).toEqual([]);
    });
});

describe('matchesWorkHistory', () => {
    const history = [item('2026-08-03', 'ct-assembly-1', 'u-tanaka')];

    it('条件未指定なら履歴が無くても通す（絞り込みをかけていない状態）', () => {
        expect(matchesWorkHistory(undefined, {}, resolveName)).toBe(true);
        expect(matchesWorkHistory([], {}, resolveName)).toBe(true);
    });

    it('条件を指定したら、合致する履歴が1件でもあれば true', () => {
        expect(matchesWorkHistory(history, { ctypeName: '組立' }, resolveName)).toBe(true);
        expect(matchesWorkHistory(history, { ctypeName: '解体' }, resolveName)).toBe(false);
    });

    it('条件を指定したら、履歴が無い案件（未着工）は除外される', () => {
        expect(matchesWorkHistory([], { from: '2026-08-01' }, resolveName)).toBe(false);
        expect(matchesWorkHistory(undefined, { foremanId: 'u-tanaka' }, resolveName)).toBe(false);
    });
});
