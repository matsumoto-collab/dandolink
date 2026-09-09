/**
 * @jest-environment node
 */
import {
    buildProjectCsvRows,
    buildWorkHistoryCsvRows,
    formatYmdJst,
    toAmountCell,
    type ProjectCsvContext,
    type ProjectCostExportRow,
} from '@/lib/projectMasterCsv';
import { escapeCsvCell, toCsvString } from '@/lib/csv';
import type { ProjectMaster, ProjectWorkHistoryItem } from '@/types/calendar';

/** ProjectAssignment.date は JST0時＝UTC前日15時で保存される。 */
const jstDay = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1, 15, 0, 0)).toISOString();
};

const NAMES: Record<string, string> = {
    'ct-assembly': '組立',
    'ct-demolition': '解体',
    'ct-other': '養生',
};
const resolveCtypeName = (id: string | null) => (id ? NAMES[id] ?? id : '');

const MANAGERS: Record<string, string> = {
    'u-1': '山田太郎',
    'u-2': '鈴木次郎',
    'u-3': '佐藤三郎',
};

const work = (
    ymd: string,
    constructionType: string | null,
    foremanId: string | null,
    memberCount = 2,
): ProjectWorkHistoryItem => ({ date: jstDay(ymd), constructionType, foremanId, memberCount });

const pm = (over: Partial<ProjectMaster> = {}): ProjectMaster => ({
    id: 'pm-1',
    title: '山田様邸 足場工事',
    name: '山田様邸',
    honorific: '様邸',
    constructionSuffixId: 'sfx-1',
    customerName: '株式会社テスト建設',
    customerShortName: 'テスト建設',
    constructionType: '組立' as ProjectMaster['constructionType'],
    constructionContent: 'new_construction' as ProjectMaster['constructionContent'],
    status: 'active',
    city: '静岡市葵区',
    location: '1-2-3',
    createdBy: ['u-1'],
    createdAt: new Date('2026-01-05T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    assignmentCount: 3,
    workHistory: [
        work('2026-01-10', 'ct-assembly', 'u-1', 3),
        work('2026-01-20', 'ct-other', 'u-2', 2),
        work('2026-02-15', 'ct-demolition', 'u-1', 4),
    ],
    ...over,
});

/** `/api/project-masters/export-costs` の1行ぶん（原価エンジンの実計上額）。 */
const cost = (over: Partial<ProjectCostExportRow> = {}): ProjectCostExportRow => ({
    id: 'pm-1',
    revenue: 900000,
    revenueSource: 'invoice',
    subcontractorCost: 200000,
    materialCost: 50000,
    loadingCost: 30000,
    laborCost: 300000,
    vehicleCost: 20000,
    otherExpenses: 10000,
    totalCost: 610000,
    laborHours: 63.5,
    laborManDays: 9,
    ...over,
});

const ctx = (over: Partial<ProjectCsvContext> = {}): ProjectCsvContext => ({
    canSeeFinancials: true,
    managerMap: MANAGERS,
    suffixMap: { 'sfx-1': '外部足場工事' },
    resolveCtypeName,
    resolveBillingBasis: () => ({ amount: 1000000, source: 'single' }),
    invoicedByProject: { 'pm-1': 400000 },
    estimateCountByProject: { 'pm-1': 1 },
    resolveBillingStatus: () => 'partial',
    workFilter: {},
    costById: { 'pm-1': cost() },
    ...over,
});

/** ヘッダ行から列名 → 値を引く。 */
const cell = (rows: string[][], rowIndex: number, column: string): string => {
    const i = rows[0].indexOf(column);
    if (i < 0) throw new Error(`列がありません: ${column}`);
    return rows[rowIndex][i];
};

describe('formatYmdJst / toAmountCell', () => {
    it('UTC前日15時の保存値を JST の当日にする', () => {
        expect(formatYmdJst(jstDay('2026-08-03'))).toBe('2026-08-03');
        expect(formatYmdJst(new Date(jstDay('2026-12-31')))).toBe('2026-12-31');
    });

    it('未設定・不正な日付は空文字', () => {
        expect(formatYmdJst(undefined)).toBe('');
        expect(formatYmdJst('not-a-date')).toBe('');
    });

    it('金額は桁区切りなしの整数・空値は空文字', () => {
        expect(toAmountCell(1234567)).toBe('1234567');
        expect(toAmountCell('89000.4')).toBe('89000');
        expect(toAmountCell(null)).toBe('');
        expect(toAmountCell(undefined)).toBe('');
        expect(toAmountCell('abc')).toBe('');
    });
});

describe('buildProjectCsvRows', () => {
    it('金額列は canSeeFinancials のときだけ出す', () => {
        const withMoney = buildProjectCsvRows([pm()], ctx({ canSeeFinancials: true }));
        const withoutMoney = buildProjectCsvRows([pm()], ctx({ canSeeFinancials: false }));

        expect(withMoney[0]).toContain('契約金額(税抜)');
        expect(withMoney[0]).toContain('請求済み金額(税抜)');
        expect(withMoney[0]).toContain('見積有無');
        expect(withoutMoney[0]).not.toContain('契約金額(税抜)');
        expect(withoutMoney[0]).not.toContain('請求済み金額(税抜)');
        expect(withoutMoney[0]).not.toContain('見積有無');
        // 金額ブロック（22列）ぶんだけ列数が減る
        expect(withMoney[0].length - withoutMoney[0].length).toBe(22);
        // 行の列数はヘッダと必ず一致する
        expect(withMoney[1].length).toBe(withMoney[0].length);
        expect(withoutMoney[1].length).toBe(withoutMoney[0].length);
    });

    it('担当者・工事名称・ステータス・工事内容を解決する', () => {
        const rows = buildProjectCsvRows([pm({ createdBy: ['u-1', 'u-3'] })], ctx());
        expect(cell(rows, 1, '担当者')).toBe('山田太郎、佐藤三郎');
        expect(cell(rows, 1, '工事名称')).toBe('外部足場工事');
        expect(cell(rows, 1, 'ステータス')).toBe('進行中');
        expect(cell(rows, 1, '工事内容')).toBe('新築');
        expect(cell(rows, 1, '現場名')).toBe('山田様邸');
        expect(cell(rows, 1, '正式名称')).toBe('山田様邸 足場工事');
    });

    it('配置ゼロなら未着工', () => {
        const rows = buildProjectCsvRows([pm({ assignmentCount: 0, workHistory: [] })], ctx());
        expect(cell(rows, 1, 'ステータス')).toBe('未着工');
        expect(cell(rows, 1, '配置件数')).toBe('0');
    });

    it('作業履歴を集約する（初回/最終/延べ人数/組立日/解体日/職長）', () => {
        const rows = buildProjectCsvRows([pm()], ctx());
        expect(cell(rows, 1, '初回作業日')).toBe('2026-01-10');
        expect(cell(rows, 1, '最終作業日')).toBe('2026-02-15');
        expect(cell(rows, 1, '延べ人数')).toBe('9');
        expect(cell(rows, 1, '組立日')).toBe('2026-01-10');
        expect(cell(rows, 1, '解体日')).toBe('2026-02-15');
        expect(cell(rows, 1, '職長')).toBe('山田太郎、鈴木次郎');
    });

    it('作業履歴の集約は絞り込み条件に関係なく全履歴で行う', () => {
        const rows = buildProjectCsvRows(
            [pm()],
            ctx({ workFilter: { from: '2026-02-01', ctypeName: '解体' } }),
        );
        expect(cell(rows, 1, '延べ人数')).toBe('9');
        expect(cell(rows, 1, '初回作業日')).toBe('2026-01-10');
    });

    it('見積金額の根拠ラベルと請求残を出す', () => {
        const picked = buildProjectCsvRows(
            [pm()],
            ctx({ resolveBillingBasis: () => ({ amount: 1000000, source: 'picked' }) }),
        );
        expect(cell(picked, 1, '見積金額の根拠')).toBe('選択した見積');
        expect(cell(picked, 1, '見積金額(税抜)')).toBe('1000000');
        expect(cell(picked, 1, '請求済み金額(税抜)')).toBe('400000');
        expect(cell(picked, 1, '請求残(税抜)')).toBe('600000');

        const contract = buildProjectCsvRows(
            [pm()],
            ctx({ resolveBillingBasis: () => ({ amount: 300000, source: 'contract' }) }),
        );
        expect(cell(contract, 1, '見積金額の根拠')).toBe('契約金額');
        // 請求済みが基準額を上回るとマイナスになる（そのまま出す）
        expect(cell(contract, 1, '請求残(税抜)')).toBe('-100000');
    });

    it('基準額が決まらないときは見積金額・請求残ともに空文字', () => {
        const rows = buildProjectCsvRows(
            [pm()],
            ctx({ resolveBillingBasis: () => ({ amount: null, source: 'none' }), resolveBillingStatus: () => 'none' }),
        );
        expect(cell(rows, 1, '見積金額(税抜)')).toBe('');
        expect(cell(rows, 1, '見積金額の根拠')).toBe('');
        expect(cell(rows, 1, '請求残(税抜)')).toBe('');
        expect(cell(rows, 1, '請求ステータス')).toBe('—');
    });

    it('請求ステータスの手動上書きを示す', () => {
        const auto = buildProjectCsvRows([pm()], ctx());
        expect(cell(auto, 1, '請求ステータス')).toBe('一部');
        expect(cell(auto, 1, '請求ステータス手動')).toBe('');

        const manual = buildProjectCsvRows(
            [pm({ billingStatusOverride: 'full' })],
            ctx({ resolveBillingStatus: () => 'full' }),
        );
        expect(cell(manual, 1, '請求ステータス')).toBe('済');
        expect(cell(manual, 1, '請求ステータス手動')).toBe('手動');
    });

    it('原価は案件マスタの予定単価ではなく原価エンジンの実計上額を出す', () => {
        const rows = buildProjectCsvRows(
            // 案件マスタ側の予定値（協力業者費・材料費）は無視され、costById の値が出る
            [Object.assign(pm({
                materialCost: 999999,
                subcontractorCosts: [{ id: 'sc-1', constructionTypeId: 'ct-assembly', amount: 111111 }],
                hasEstimate: true,
                hasInvoice: false,
            }), { loadingCost: '888888' })],
            ctx(),
        );
        expect(cell(rows, 1, '外注費')).toBe('200000');
        expect(cell(rows, 1, '材料費')).toBe('50000');
        expect(cell(rows, 1, '積込費')).toBe('30000');
        expect(cell(rows, 1, '人件費')).toBe('300000');
        expect(cell(rows, 1, '車両費')).toBe('20000');
        expect(cell(rows, 1, 'その他経費')).toBe('10000');
        expect(cell(rows, 1, '原価合計')).toBe('610000');
        expect(cell(rows, 1, '実績人時')).toBe('63.5');
        expect(cell(rows, 1, '実績人日')).toBe('9');
        expect(cell(rows, 1, '見積有無')).toBe('有');
        expect(cell(rows, 1, '請求有無')).toBe('無');
        // 旧列は出さない
        expect(rows[0]).not.toContain('協力業者費合計');
        expect(rows[0]).not.toContain('協力業者費内訳');
    });

    it('売上の区分ラベルを出す', () => {
        const label = (revenueSource: ProjectCostExportRow['revenueSource']) => {
            const rows = buildProjectCsvRows([pm()], ctx({ costById: { 'pm-1': cost({ revenueSource }) } }));
            return cell(rows, 1, '売上の区分');
        };
        expect(label('override')).toBe('手動上書き');
        expect(label('invoice')).toBe('請求済み');
        expect(label('contract')).toBe('契約金額');
        expect(label('estimate')).toBe('見積');
        expect(label('none')).toBe('');
    });

    it('粗利は 売上 − 原価合計。売上が決まっていない（区分 none）なら空文字', () => {
        const ok = buildProjectCsvRows([pm()], ctx());
        expect(cell(ok, 1, '売上(税抜)')).toBe('900000');
        expect(cell(ok, 1, '粗利')).toBe('290000');

        // 原価が売上を上回ればマイナスのまま出す
        const minus = buildProjectCsvRows(
            [pm()],
            ctx({ costById: { 'pm-1': cost({ revenue: 500000, totalCost: 610000 }) } }),
        );
        expect(cell(minus, 1, '粗利')).toBe('-110000');

        const none = buildProjectCsvRows(
            [pm()],
            ctx({ costById: { 'pm-1': cost({ revenue: 0, revenueSource: 'none' }) } }),
        );
        expect(cell(none, 1, '売上(税抜)')).toBe('0');
        expect(cell(none, 1, '粗利')).toBe('');
        // 原価自体は none でもそのまま出す
        expect(cell(none, 1, '原価合計')).toBe('610000');
    });

    it('原価が取得できなかった案件は原価・売上の列を空文字にする（他の列は出す）', () => {
        const rows = buildProjectCsvRows([pm()], ctx({ costById: {} }));
        for (const col of ['売上(税抜)', '売上の区分', '外注費', '材料費', '積込費', '人件費', '車両費', 'その他経費', '原価合計', '粗利', '実績人時', '実績人日']) {
            expect(cell(rows, 1, col)).toBe('');
        }
        // 原価ブロック以外は従来どおり
        expect(cell(rows, 1, '請求済み金額(税抜)')).toBe('400000');
        expect(cell(rows, 1, '請求ステータス')).toBe('一部');
        expect(rows[1].length).toBe(rows[0].length);

        // costById 自体が無い（非取得）ときも同じ
        const noCtx = buildProjectCsvRows([pm()], ctx({ costById: undefined }));
        expect(cell(noCtx, 1, '原価合計')).toBe('');
    });

    it('登録日・更新日を JST に直す（UTC15時は翌日）', () => {
        const rows = buildProjectCsvRows(
            [pm({ createdAt: new Date('2026-03-31T15:30:00.000Z'), updatedAt: new Date('2026-04-01T00:00:00.000Z') })],
            ctx(),
        );
        expect(cell(rows, 1, '登録日')).toBe('2026-04-01');
        expect(cell(rows, 1, '更新日')).toBe('2026-04-01');
    });

    it('渡された順（画面の表示順）のまま出す', () => {
        const rows = buildProjectCsvRows(
            [pm({ id: 'pm-1', name: 'A邸' }), pm({ id: 'pm-2', name: 'B邸' })],
            ctx(),
        );
        expect(cell(rows, 1, '現場名')).toBe('A邸');
        expect(cell(rows, 2, '現場名')).toBe('B邸');
    });
});

describe('buildWorkHistoryCsvRows', () => {
    it('作業履歴1件＝1行で出し、職長名を解決する', () => {
        const rows = buildWorkHistoryCsvRows([pm()], ctx());
        expect(rows.length).toBe(4); // ヘッダ + 3件
        expect(cell(rows, 1, '作業日')).toBe('2026-01-10');
        expect(cell(rows, 1, '工事種別')).toBe('組立');
        expect(cell(rows, 1, '職長')).toBe('山田太郎');
        expect(cell(rows, 1, '人数')).toBe('3');
        expect(cell(rows, 2, '職長')).toBe('鈴木次郎');
        expect(cell(rows, 1, '現場名')).toBe('山田様邸');
        expect(cell(rows, 1, '元請会社')).toBe('株式会社テスト建設');
    });

    it('金額列は持たない（ロールに関係なく同じ列）', () => {
        const a = buildWorkHistoryCsvRows([pm()], ctx({ canSeeFinancials: true }))[0];
        const b = buildWorkHistoryCsvRows([pm()], ctx({ canSeeFinancials: false }))[0];
        expect(a).toEqual(b);
    });

    it('作業履歴で絞り込み中は該当した履歴だけを出す', () => {
        const rows = buildWorkHistoryCsvRows([pm()], ctx({ workFilter: { ctypeName: '組立' } }));
        expect(rows.length).toBe(2);
        expect(cell(rows, 1, '作業日')).toBe('2026-01-10');

        const byForeman = buildWorkHistoryCsvRows([pm()], ctx({ workFilter: { foremanId: 'u-1' } }));
        expect(byForeman.length).toBe(3);

        const byRange = buildWorkHistoryCsvRows([pm()], ctx({ workFilter: { from: '2026-01-15', to: '2026-02-01' } }));
        expect(byRange.length).toBe(2);
        expect(cell(byRange, 1, '作業日')).toBe('2026-01-20');
    });

    it('作業日の昇順・同日は案件の並び順で出す', () => {
        const a = pm({ id: 'pm-1', name: 'A邸', workHistory: [work('2026-03-05', 'ct-assembly', 'u-1'), work('2026-01-05', 'ct-assembly', 'u-1')] });
        const b = pm({ id: 'pm-2', name: 'B邸', workHistory: [work('2026-02-05', 'ct-assembly', 'u-2'), work('2026-01-05', 'ct-demolition', 'u-2')] });
        const rows = buildWorkHistoryCsvRows([a, b], ctx());
        expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([
            ['2026-01-05', 'A邸'],
            ['2026-01-05', 'B邸'],
            ['2026-02-05', 'B邸'],
            ['2026-03-05', 'A邸'],
        ]);
    });

    it('作業履歴が無い案件は行を作らない', () => {
        const rows = buildWorkHistoryCsvRows([pm({ workHistory: [] }), pm({ id: 'pm-2', workHistory: undefined })], ctx());
        expect(rows.length).toBe(1);
    });
});

describe('lib/csv', () => {
    it('カンマ・ダブルクォート・改行を含むセルだけ引用符で囲む', () => {
        expect(escapeCsvCell('普通')).toBe('普通');
        expect(escapeCsvCell('山田、鈴木')).toBe('山田、鈴木'); // 全角読点は囲まない
        expect(escapeCsvCell('a,b')).toBe('"a,b"');
        expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
        expect(escapeCsvCell('1行目\n2行目')).toBe('"1行目\n2行目"');
    });

    it('BOM 始まり・CRLF 区切りで組み立てる', () => {
        const csv = toCsvString([['a', 'b'], ['1', '2']]);
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv).toBe('﻿a,b\r\n1,2');
    });

    it('案件CSVをそのまま CSV 文字列にできる', () => {
        const csv = toCsvString(buildProjectCsvRows([pm()], ctx()));
        expect(csv.startsWith('﻿現場名,')).toBe(true);
        expect(csv.split('\r\n').length).toBe(2);
    });
});
