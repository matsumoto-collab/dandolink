import {
    buildOrderBacklogSheet,
    monthColumns,
    toReiwaAsOfLabel,
    toThousands,
    ymToSlash,
    type OrderBacklogSheetReport,
} from '@/lib/orderBacklog/render';
import { DEFAULT_INDIVIDUAL_THRESHOLD, type OrderBacklogLineInput } from '@/lib/orderBacklog/types';

const report = (over: Partial<OrderBacklogSheetReport> = {}): OrderBacklogSheetReport => ({
    asOfDate: '2026-06-01',
    individualThreshold: DEFAULT_INDIVIDUAL_THRESHOLD,
    unreceivedMode: 'remaining',
    ...over,
});

const line = (over: Partial<OrderBacklogLineInput> = {}): OrderBacklogLineInput => ({
    projectMasterId: null,
    customerName: '得意先',
    projectName: '工事',
    workKind: 'temp',
    siteKind: 'other',
    contractAmount: 0,
    startYm: null,
    endYm: null,
    progressRate: 0,
    receivedAmount: 0,
    schedule: {},
    excluded: false,
    isManual: false,
    sortOrder: 0,
    ...over,
});

describe('monthColumns', () => {
    it('基準月から9列（最終列は「N月以降」）', () => {
        const columns = monthColumns('2026-06-01');
        expect(columns).toHaveLength(9);
        expect(columns.map((c) => c.label)).toEqual([
            '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月以降',
        ]);
    });

    it('12月の次は1月に巻き戻る（年も進む）', () => {
        const columns = monthColumns('2026-06-01');
        expect(columns[6].key).toBe('2026-12');
        expect(columns[7].key).toBe('2027-01');
        expect(columns[7].monthNumber).toBe(1);
        // 最終列は月ではなく 'later'（基準月+8以降をまとめる箱）
        expect(columns[8].key).toBe('later');
        expect(columns[8].monthNumber).toBe(2);
    });

    it('年末が基準月でも正しく進む', () => {
        expect(monthColumns('2026-11-01').map((c) => c.monthNumber)).toEqual([11, 12, 1, 2, 3, 4, 5, 6, 7]);
    });
});

describe('見出しと単位', () => {
    it('基準日は和暦にする', () => {
        expect(toReiwaAsOfLabel('2026-06-01')).toBe('（令和8年6月1日現在）');
        expect(toReiwaAsOfLabel('2019-05-01')).toBe('（令和1年5月1日現在）');
    });

    it('金額は千円へ四捨五入', () => {
        expect(toThousands(1234567)).toBe(1235);
        expect(toThousands(500)).toBe(1);
        expect(toThousands(499)).toBe(0);
        expect(toThousands(0)).toBe(0);
    });

    it('着工・完成予定は 2026/5 形式', () => {
        expect(ymToSlash('2026-05')).toBe('2026/5');
        expect(ymToSlash('2026-12')).toBe('2026/12');
        expect(ymToSlash(null)).toBeUndefined();
    });
});

describe('buildOrderBacklogSheet', () => {
    const lines: OrderBacklogLineInput[] = [
        line({
            customerName: 'A社', projectName: 'A工事', contractAmount: 5000000, progressRate: 50,
            receivedAmount: 1000000, startYm: '2026-05', endYm: '2026-08',
            schedule: { '2026-07': 4000000 }, sortOrder: 0,
        }),
        line({ customerName: 'C社', projectName: 'C工事', contractAmount: 3000000, sortOrder: 2 }),
        line({ customerName: 'B社', projectName: 'B工事', contractAmount: 3000000, sortOrder: 1 }),
        line({ customerName: 'D社', contractAmount: 600000, schedule: { '2026-08': 600000 } }),
        line({ customerName: 'E社', contractAmount: 400000, schedule: { '2026-08': 400000 } }),
        line({ customerName: 'F社', contractAmount: 300000 }),
    ];

    it('個別行は契約額の降順・同額は sortOrder 順、そのあとに区分行', () => {
        const sheet = buildOrderBacklogSheet(report(), lines);
        expect(sheet.rows.map((r) => `${r.code}:${r.kind}:${r.top}`)).toEqual([
            '1:project:A社',
            '2:project:B社',
            '3:project:C社',
            '4:bucket:その他仮設工事　1件',
            '5:bucket:その他仮設工事　2件',
        ]);
        expect(sheet.rows[3].bottom).toBe('50万～100万の工事');
        expect(sheet.rows[4].bottom).toBe('～50万の工事');
    });

    it('件数0の区分は出さない', () => {
        const sheet = buildOrderBacklogSheet(report(), [lines[0]]);
        expect(sheet.rows.every((r) => r.kind === 'project')).toBe(true);
        expect(sheet.rows).toHaveLength(1);
    });

    it('個別行は契約額・出来高・既受領・入金予定を千円で持つ', () => {
        const row = buildOrderBacklogSheet(report(), lines).rows[0];
        expect(row.contractK).toBe(5000);
        expect(row.progressRate).toBe(0.5);
        expect(row.progressAmountK).toBe(2500);
        expect(row.receivedK).toBe(1000);
        expect(row.startYm).toBe('2026/5');
        expect(row.endYm).toBe('2026/8');
        expect(row.scheduleK).toEqual([0, 4000, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('区分行は出来高％・着工・完成が空欄で、金額は所属行の合計', () => {
        const sheet = buildOrderBacklogSheet(report(), lines);
        const low = sheet.rows[4];
        expect(low.progressRate).toBeUndefined();
        expect(low.progressAmountK).toBeUndefined();
        expect(low.startYm).toBeUndefined();
        expect(low.contractK).toBe(700); // 400,000 + 300,000
        expect(sheet.rows[3].scheduleK[2]).toBe(600);
        expect(low.scheduleK[2]).toBe(400);
    });

    it('区分行は円で足してから丸める（1件ずつ丸めない）', () => {
        const sheet = buildOrderBacklogSheet(report(), [
            line({ contractAmount: 499600 }),
            line({ contractAmount: 499600 }),
        ]);
        // 1件ずつ丸めると 500+500=1000 になるが、円で足すと 999,200→999
        expect(sheet.rows[0].contractK).toBe(999);
    });

    it('未受領は remaining＝契約額−出来高金額', () => {
        const sheet = buildOrderBacklogSheet(report({ unreceivedMode: 'remaining' }), lines);
        expect(sheet.rows[0].unreceivedK).toBe(2500); // 5000 - 2500
        expect(sheet.rows[4].unreceivedK).toBe(700); // 出来高0なので契約額そのまま
    });

    it('未受領は unpaid＝出来高金額−既受領', () => {
        const sheet = buildOrderBacklogSheet(report({ unreceivedMode: 'unpaid' }), lines);
        expect(sheet.rows[0].unreceivedK).toBe(1500); // 2500 - 1000
        expect(sheet.rows[4].unreceivedK).toBe(0); // 出来高0・既受領0
    });

    it('計は表示している千円の合計（ExcelのSUMと一致）', () => {
        const sheet = buildOrderBacklogSheet(report(), lines);
        expect(sheet.totals.contractK).toBe(5000 + 3000 + 3000 + 600 + 700);
        expect(sheet.totals.receivedK).toBe(1000);
        expect(sheet.totals.unreceivedK).toBe(
            sheet.rows.reduce((s, r) => s + r.unreceivedK, 0),
        );
        expect(sheet.totals.scheduleK).toHaveLength(9);
        expect(sheet.totals.scheduleK[1]).toBe(4000);
        expect(sheet.totals.scheduleK[2]).toBe(1000); // 600 + 400
    });

    it('除外した行は個別行にも区分集約にも入れない', () => {
        const sheet = buildOrderBacklogSheet(report(), [
            line({ customerName: 'A社', contractAmount: 5000000, excluded: true }),
            line({ customerName: 'D社', contractAmount: 600000, excluded: true }),
            line({ customerName: 'E社', contractAmount: 400000 }),
        ]);
        expect(sheet.rows).toHaveLength(1);
        expect(sheet.rows[0].top).toBe('その他仮設工事　1件');
        expect(sheet.totals.contractK).toBe(400);
    });

    it('入金予定は基準月より前を第1列へ、範囲外と later を最終列へ寄せる', () => {
        const sheet = buildOrderBacklogSheet(report(), [
            line({
                contractAmount: 5000000,
                schedule: { '2026-05': 500000, later: 1000000, '2027-05': 200000 },
            }),
        ]);
        expect(sheet.rows[0].scheduleK[0]).toBe(500);
        expect(sheet.rows[0].scheduleK[8]).toBe(1200); // 1,000,000 + 200,000
    });

    it('申込人は空欄でも見出しを崩さない', () => {
        expect(buildOrderBacklogSheet(report(), []).applicantLabel).toBe('申込人　');
        expect(buildOrderBacklogSheet(report({ applicantName: '祐伸' }), []).applicantLabel).toBe('申込人　祐伸');
    });

    it('26枠を超えたらページを分ける（計は最終ページのみ）', () => {
        const many = Array.from({ length: 27 }, (_, i) =>
            line({ customerName: `顧客${i}`, contractAmount: 1000000 + i, sortOrder: i }),
        );
        const sheet = buildOrderBacklogSheet(report(), many);
        expect(sheet.rows).toHaveLength(27);
        expect(sheet.pages).toHaveLength(2);
        expect(sheet.pages[0]).toHaveLength(26);
        expect(sheet.pages[1]).toHaveLength(1);
        expect(sheet.pages[1][0].code).toBe(27);
    });

    it('26枠ちょうどなら1ページ・明細が無くても1ページは返す', () => {
        const exact = Array.from({ length: 26 }, (_, i) => line({ contractAmount: 1000000 + i }));
        expect(buildOrderBacklogSheet(report(), exact).pages).toHaveLength(1);
        expect(buildOrderBacklogSheet(report(), []).pages).toEqual([[]]);
    });
});

describe('buildOrderBacklogSheet: 契約額 0 の明細', () => {
    const report = { asOfDate: '2026-06-01', individualThreshold: 1000000, unreceivedMode: 'remaining' as const };

    it('契約額 0 の行は出力にも区分の件数にも入れず、件数だけ知らせる', () => {
        const sheet = buildOrderBacklogSheet(report, [
            line({ projectName: '金額あり', contractAmount: 300000, sortOrder: 0 }),
            line({ projectName: '金額なし', contractAmount: 0, sortOrder: 1 }),
            line({ projectName: '金額なし除外済み', contractAmount: 0, excluded: true, sortOrder: 2 }),
        ]);
        expect(sheet.omittedNoAmountCount).toBe(1);
        expect(sheet.rows).toHaveLength(1);
        expect(sheet.rows[0].kind).toBe('bucket');
        expect(sheet.rows[0].top).toBe('その他仮設工事　1件');
        expect(sheet.totals.contractK).toBe(300);
    });

    it('全部に金額があれば 0 件', () => {
        const sheet = buildOrderBacklogSheet(report, [line({ contractAmount: 2000000 })]);
        expect(sheet.omittedNoAmountCount).toBe(0);
    });
});
