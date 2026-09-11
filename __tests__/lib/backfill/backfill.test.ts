/**
 * 過去データ取込（lib/backfill）の純粋関数。
 * CSV の読み取り・検査・名前の照合・期の数え方・期間集計の切り替えを固定する。
 */
import { parseCsv, csvToRecords } from '@/lib/backfill/csv';
import { parseBackfillFiles } from '@/lib/backfill/parse';
import { buildCustomerMatcher, buildForemanMatcher, normalizeCompanyName } from '@/lib/backfill/matching';
import {
    countsInPeriodAggregate,
    fiscalTermOf,
    fiscalTermRange,
    isLiveMonth,
    jstDateToInstant,
    jstYearMonthOf,
    withConsumptionTax,
} from '@/lib/backfill/constants';

const HEAD = {
    projects: '案件ID,現場名,顧客,出典,初日,最終日,非現場',
    sales: '案件ID,請求日,金額税抜,顧客,元の現場名,出典',
    works: '案件ID,作業日,職長,人数,区分,人数補完,元の現場名,元請',
    adjustments: '顧客,年月,調整額税抜,売上入金表,請求書PDF',
};

function files(p: string[], s: string[] = [], w: string[] = [], a: string[] = []) {
    return {
        projects: [HEAD.projects, ...p].join('\r\n'),
        sales: [HEAD.sales, ...s].join('\r\n'),
        works: [HEAD.works, ...w].join('\r\n'),
        adjustments: [HEAD.adjustments, ...a].join('\r\n'),
    };
}

describe('parseCsv', () => {
    it('引用符で囲まれたカンマ・二重引用符・BOM・CRLF を正しく読む', () => {
        const rows = parseCsv('﻿a,b\r\nH00858,"P,spo24伊予店様 仮設工事"\r\nx,"say ""hi"""\r\n\r\n');
        expect(rows).toEqual([
            ['a', 'b'],
            ['H00858', 'P,spo24伊予店様 仮設工事'],
            ['x', 'say "hi"'],
        ]);
    });

    it('見出しで引ける形にし、行番号は見出し行を 1 として数える', () => {
        const { headers, records } = csvToRecords('案件ID,現場名\nH00001,A\nH00002,B');
        expect(headers).toEqual(['案件ID', '現場名']);
        expect(records[1]).toEqual({ line: 3, values: { 案件ID: 'H00002', 現場名: 'B' } });
    });
});

describe('parseBackfillFiles', () => {
    it('正しいファイルは取り込める形になり、外注の人数・非現場・人数補完を読み分ける', () => {
        const r = parseBackfillFiles(files(
            ['H00001,松本様邸 新築工事,富士造型,請求書+日報,2024-01-15,2024-03-15,', 'H00002,土場,,日報のみ,2024-02-01,2024-02-01,該当'],
            ['H00001,2024-01-15,163400,株式会社富士造型,松本様邸 新築工事,請求書PDF'],
            ['H00001,2024-01-20,東本,3,自社,1,松本,富士造型', 'H00001,2024-01-20,龍成工業,2,外注,0,松本,富士造型'],
            ['エスケー化研,2024-01,736840,736840,0'],
        ));
        expect(r.errors).toEqual([]);
        expect(r.projects[1]).toMatchObject({ externalKey: 'H00002', isNonSite: true, dataSource: '日報のみ' });
        expect(r.sales[0]).toMatchObject({ externalKey: 'H00001-2024-01-15-1', amountExclTax: 163400 });
        expect(r.works[0]).toMatchObject({ category: '自社', originalHeadcount: 3, headcountFilled: true });
        expect(r.works[1]).toMatchObject({ category: '外注', originalHeadcount: 2 });
        expect(r.adjustments[0]).toMatchObject({ externalKey: 'エスケー化研|2024-01', amountExclTax: 736840 });
    });

    it('同じ組み合わせの行には出現順で連番を振る（分割請求・同じ日に同じ職長が 2 回）', () => {
        const r = parseBackfillFiles(files(
            ['H00001,A,B,請求書+日報,2024-01-01,2024-01-31,'],
            ['H00001,2024-01-31,100,B,A,請求書PDF', 'H00001,2024-01-31,200,B,A,請求書PDF'],
            ['H00001,2024-01-05,東本,2,自社,0,A,B', 'H00001,2024-01-05,楠岡,2,自社,0,A,B', 'H00001,2024-01-05,東本,1,自社,1,A,B'],
        ));
        expect(r.sales.map((s) => s.externalKey)).toEqual(['H00001-2024-01-31-1', 'H00001-2024-01-31-2']);
        // 職長ごとに数えるので、楠岡の行が間に入っても東本の 2 行目は -2 のまま
        expect(r.works.map((w) => w.externalKey)).toEqual([
            'H00001-2024-01-05-東本-1',
            'H00001-2024-01-05-楠岡-1',
            'H00001-2024-01-05-東本-2',
        ]);
    });

    it('案件CSVに無い案件ID・壊れた日付・2026-05 以降の行はエラーにする（二重計上を防ぐ）', () => {
        const r = parseBackfillFiles(files(
            ['H00001,A,B,請求書,2024-01-01,2024-01-31,'],
            ['H99999,2024-01-31,100,B,A,請求書PDF', 'H00001,2024-02-30,100,B,A,請求書PDF', 'H00001,2026-05-01,100,B,A,請求書PDF'],
            [],
            ['X社,2026-05,100,100,0'],
        ));
        const messages = r.errors.map((e) => `${e.file}:${e.line}`);
        expect(messages).toEqual(['sales:2', 'sales:3', 'sales:4', 'adjustments:2']);
    });

    it('見出しが違うファイルは、何が足りないかをエラーで返す', () => {
        const r = parseBackfillFiles({ ...files([]), sales: '案件ID,請求日,金額\nH00001,2024-01-01,1' });
        expect(r.errors[0]).toMatchObject({ file: 'sales', line: 1 });
        expect(r.errors[0].message).toContain('金額税抜');
    });

    it('出典=請求書 なのに自社人工がある案件は注意として出す（元データの出典の付け間違い）', () => {
        const r = parseBackfillFiles(files(
            ['H00001,A,B,請求書,2024-01-01,2024-01-31,'],
            [],
            ['H00001,2024-01-05,東本,2,自社,0,A,B'],
        ));
        expect(r.errors).toEqual([]);
        expect(r.warnings[0].message).toContain('自社人工が 2');
    });
});

describe('名前の照合', () => {
    it('法人格と空白を取り除いて比べる', () => {
        expect(normalizeCompanyName('株式会社 富士造型')).toBe('富士造型');
        expect(normalizeCompanyName('(株)エスケー化研')).toBe('エスケー化研');
        expect(normalizeCompanyName('鉄建工業　株式会社')).toBe('鉄建工業');
    });

    it('職長は完全一致を優先し、無ければ前方一致が 1 人だけのときに寄せる', () => {
        const match = buildForemanMatcher([
            { id: 'u1', displayName: '東本' },
            { id: 'u2', displayName: '龍成工業' },
            { id: 'u3', displayName: '修栄工業' },
            { id: 'u4', displayName: '田畑' },
        ]);
        expect(match('東本')).toBe('u1');
        expect(match('龍成')).toBe('u2'); // 日報の略し書き
        expect(match('全員')).toBeNull();
        expect(match('')).toBeNull();
    });

    it('顧客は同じ名前が 2 社あると取り違えを避けて一致なしにする', () => {
        const match = buildCustomerMatcher([
            { id: 'c1', name: '株式会社富士造型' },
            { id: 'c2', name: '菊池塗装' },
            { id: 'c3', name: '有限会社菊池塗装' },
        ]);
        expect(match('富士造型')?.id).toBe('c1');
        expect(match('菊池塗装')).toBeNull();
        expect(match('菊地塗装')).toBeNull(); // 表記ゆれは寄せない
    });
});

describe('期と期間集計の切り替え', () => {
    it('期は 3 月始まり（第11期 = 2024-03〜2025-02）', () => {
        expect(fiscalTermOf('2024-03')).toBe(11);
        expect(fiscalTermOf('2025-02')).toBe(11);
        expect(fiscalTermOf('2025-03')).toBe(12);
        expect(fiscalTermOf('2024-01')).toBe(10);
        expect(fiscalTermRange(12)).toEqual({ from: '2025-03', to: '2026-02' });
    });

    it('2026-04 までは過去データだけ、2026-05 からは DandoLink のデータだけを数える', () => {
        expect(isLiveMonth('2026-04')).toBe(false);
        expect(isLiveMonth('2026-05')).toBe(true);
        expect(countsInPeriodAggregate(true, '2026-04')).toBe(true);
        expect(countsInPeriodAggregate(false, '2026-04')).toBe(false); // 試用期間の本物のデータ
        expect(countsInPeriodAggregate(false, '2026-05')).toBe(true);
        expect(countsInPeriodAggregate(true, '2026-05')).toBe(false);
    });

    it('日付は JST のカレンダー日として保存し、月も JST で読む', () => {
        const d = jstDateToInstant('2024-03-01');
        expect(d.toISOString()).toBe('2024-02-29T15:00:00.000Z');
        expect(jstYearMonthOf(d)).toBe('2024-03');
    });

    it('売上調整は税抜なので、月商（税込）には 10% を戻して足す', () => {
        expect(withConsumptionTax(736840)).toBe(810524);
        expect(withConsumptionTax(-19124579)).toBe(-21037037);
    });
});
