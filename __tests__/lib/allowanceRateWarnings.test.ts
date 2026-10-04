import {
    ALLOWANCE_RATE_WARNING_MESSAGES,
    allowanceRateWarnings,
    type AllowanceRateWarningInput,
} from '@/lib/allowanceRateWarnings';

const TODAY = '2026-10-05';

/** 何も当たらない基本の入力（今の金額 職長 1,500円・職長以外 200円 → 職長 1,600円・職長以外 250円・明日から） */
function input(overrides: Partial<AllowanceRateWarningInput> = {}): AllowanceRateWarningInput {
    return {
        foremanAmount: 1600,
        memberAmount: 250,
        current: { foremanAmount: 1500, memberAmount: 200 },
        effectiveFrom: '2026-10-06',
        today: TODAY,
        ...overrides,
    };
}

const codesOf = (i: AllowanceRateWarningInput) => allowanceRateWarnings(i).map((w) => w.code);

describe('allowanceRateWarnings', () => {
    it('何も当たらないときは空の配列', () => {
        expect(allowanceRateWarnings(input())).toEqual([]);
    });

    describe('① 適用開始日が今日以前', () => {
        it('明日は当たらない', () => {
            expect(codesOf(input({ effectiveFrom: '2026-10-06' }))).toEqual([]);
        });
        it('今日ちょうどは当たる', () => {
            expect(codesOf(input({ effectiveFrom: TODAY }))).toEqual(['starts_on_or_before_today']);
        });
        it('過去の日付は当たる（月をまたいでも）', () => {
            expect(codesOf(input({ effectiveFrom: '2026-09-01' }))).toEqual(['starts_on_or_before_today']);
        });
        it('文言は指示書のとおり', () => {
            expect(allowanceRateWarnings(input({ effectiveFrom: TODAY }))[0].message).toBe(
                '適用開始日が今日以前です。この日からあとの、すでに付いている記録（締めていない月）の金額も、新しい金額に変わります。',
            );
        });
    });

    describe('② 職長の金額が職長以外より小さい', () => {
        it('小さいと当たる', () => {
            expect(codesOf(input({ foremanAmount: 240, memberAmount: 250, current: null }))).toEqual(['foreman_below_member']);
        });
        it('同じ金額は当たらない', () => {
            expect(codesOf(input({ foremanAmount: 250, memberAmount: 250, current: null }))).toEqual([]);
        });
    });

    describe('③ 今の金額の3倍以上・3分の1以下', () => {
        it('ちょうど3倍は当たる（職長）', () => {
            expect(codesOf(input({ foremanAmount: 4500 }))).toEqual(['far_from_current']);
        });
        it('3倍より1円少ないと当たらない', () => {
            expect(codesOf(input({ foremanAmount: 4499 }))).toEqual([]);
        });
        it('ちょうど3分の1は当たる（職長）', () => {
            expect(codesOf(input({ foremanAmount: 500, memberAmount: 200 }))).toEqual(['far_from_current']);
        });
        it('3分の1より1円多いと当たらない', () => {
            expect(codesOf(input({ foremanAmount: 501, memberAmount: 200 }))).toEqual([]);
        });
        it('職長以外だけが外れていても当たる（桁のまちがい）', () => {
            expect(codesOf(input({ memberAmount: 600 }))).toEqual(['far_from_current']);
        });
        it('今の金額が null のときは比べない', () => {
            expect(codesOf(input({ foremanAmount: 15000, memberAmount: 2000, current: null }))).toEqual([]);
        });
        it('今の金額が 0 の区分は比べない', () => {
            expect(codesOf(input({ foremanAmount: 1500, memberAmount: 200, current: { foremanAmount: 0, memberAmount: 0 } }))).toEqual([]);
        });
        it('文言は指示書のとおり', () => {
            expect(ALLOWANCE_RATE_WARNING_MESSAGES.far_from_current).toBe('今の金額の3倍以上（または3分の1以下）です。桁をまちがえていませんか');
        });
    });

    describe('④ 0円', () => {
        it('職長以外が 0円なら当たる（今の金額から見て3分の1以下にも当たる）', () => {
            expect(codesOf(input({ memberAmount: 0 }))).toEqual(['far_from_current', 'zero']);
        });
        it('今の金額が無くて 0円なら、0円だけ', () => {
            expect(codesOf(input({ foremanAmount: 0, memberAmount: 0, current: null }))).toEqual(['zero']);
        });
        it('文言は指示書のとおり', () => {
            expect(allowanceRateWarnings(input({ foremanAmount: 0, memberAmount: 0, current: null }))[0].message).toBe('0円になっています');
        });
    });

    it('当たったものを ①〜④ の順で全部返す', () => {
        expect(
            codesOf(input({ foremanAmount: 0, memberAmount: 200, effectiveFrom: '2026-09-01' })),
        ).toEqual(['starts_on_or_before_today', 'foreman_below_member', 'far_from_current', 'zero']);
        expect(ALLOWANCE_RATE_WARNING_MESSAGES.foreman_below_member).toBe('職長の金額が、職長以外の金額より小さくなっています');
    });
});
