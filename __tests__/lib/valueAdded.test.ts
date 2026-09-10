import {
    DEFAULT_VALUE_ADDED_SETTINGS,
    computeValueAdded,
    previewEstimateValueAdded,
    valueAddedUnavailableReason,
    type ValueAddedSettings,
} from '@/lib/valueAdded';

const SETTINGS: ValueAddedSettings = {
    ...DEFAULT_VALUE_ADDED_SETTINGS,
    breakevenPerManday: 40000,
};

/** 仕様6-3の実データ（本番DBで実測済み・2026-09-10） */
const CASES = [
    {
        name: 'ジブラルタ生命様 大規模修繕',
        sales: 11884413,
        laborCost: 2719600, subcontractorCost: 904000, totalCost: 4589210,
        headcount: 161,
        valueAdded: 10014803, perManday: 62203, outsourcingRatio: 0.249, heavy: false,
    },
    {
        name: '松山市男女共同参画推進センター様',
        sales: 3536000,
        laborCost: 3477800, subcontractorCost: 0, totalCost: 3897919,
        headcount: 185,
        valueAdded: 3115881, perManday: 16842, outsourcingRatio: 0, heavy: false,
    },
    {
        name: '道前道後第三発電所',
        sales: 600000,
        laborCost: 410000, subcontractorCost: 0, totalCost: 430000,
        headcount: 24,
        valueAdded: 580000, perManday: 24166, outsourcingRatio: 0, heavy: false,
    },
    {
        name: '愛媛製紙1原パルパ室',
        sales: 420000,
        laborCost: 104000, subcontractorCost: 0, totalCost: 117900,
        headcount: 8,
        valueAdded: 406100, perManday: 50762, outsourcingRatio: 0, heavy: false,
    },
    {
        name: 'カネシロ様 伊予松前リサイクルセンター',
        sales: 140000,
        laborCost: 5100, subcontractorCost: 63000, totalCost: 78100,
        headcount: 4,
        valueAdded: 67000, perManday: 16750, outsourcingRatio: 0.925, heavy: true,
    },
    {
        name: '清水様邸 新築',
        sales: 1100000,
        laborCost: 162200, subcontractorCost: 334200, totalCost: 518900,
        headcount: 14,
        valueAdded: 743300, perManday: 53092, outsourcingRatio: 0.673, heavy: true,
    },
    {
        name: '平松 有信様邸',
        sales: 359000,
        laborCost: 134600, subcontractorCost: 0, totalCost: 139600,
        headcount: 9,
        valueAdded: 354000, perManday: 39333, outsourcingRatio: 0, heavy: false,
    },
    {
        name: '山根 大介様邸',
        sales: 225000,
        laborCost: 18000, subcontractorCost: 165000, totalCost: 183000,
        headcount: 1,
        valueAdded: 60000, perManday: 60000, outsourcingRatio: 0.902, heavy: true,
    },
    {
        name: '濱田 裕之様邸',
        sales: 350000,
        laborCost: 96800, subcontractorCost: 94000, totalCost: 198300,
        headcount: 7,
        valueAdded: 248500, perManday: 35500, outsourcingRatio: 0.493, heavy: false,
    },
    {
        name: '一色様邸 南斎院',
        sales: 249000,
        laborCost: 35600, subcontractorCost: 72000, totalCost: 112600,
        headcount: 5,
        valueAdded: 172000, perManday: 34400, outsourcingRatio: 0.669, heavy: true,
    },
];

describe('computeValueAdded（仕様6-3の実データ10件）', () => {
    it.each(CASES)('$name', c => {
        const r = computeValueAdded(
            {
                sales: c.sales,
                cost: { laborCost: c.laborCost, subcontractorCost: c.subcontractorCost, totalCost: c.totalCost },
                headcount: c.headcount,
            },
            SETTINGS,
        );
        expect(r.valueAdded).toBe(c.valueAdded);
        expect(r.perManday).toBe(c.perManday);
        expect(r.laborOutsourcingRatio).toBeCloseTo(c.outsourcingRatio, 3);
        expect(r.outsourcingHeavy).toBe(c.heavy);
    });
});

describe('労務の外注比率', () => {
    it('外注費 ÷（外注費＋自社人件費）で計算する（売上や材料費は分母に入れない）', () => {
        const r = computeValueAdded(
            {
                sales: 11884413,
                cost: { laborCost: 2719600, subcontractorCost: 904000, totalCost: 4589210 },
                headcount: 161,
            },
            SETTINGS,
        );
        // 904,000 ÷ (904,000 + 2,719,600) = 24.9%
        expect(r.laborOutsourcingRatio).toBeCloseTo(0.2495, 3);
        expect(r.outsourcingHeavy).toBe(false);
    });

    it('しきい値50%ちょうどは「外注中心」にしない（超えたときだけ）', () => {
        const r = computeValueAdded(
            { sales: 1000000, cost: { laborCost: 100000, subcontractorCost: 100000, totalCost: 300000 }, headcount: 10 },
            SETTINGS,
        );
        expect(r.laborOutsourcingRatio).toBe(0.5);
        expect(r.outsourcingHeavy).toBe(false);
    });

    it('人件費も外注費も0なら比率は出さない', () => {
        const r = computeValueAdded(
            { sales: 500000, cost: { laborCost: 0, subcontractorCost: 0, totalCost: 50000 }, headcount: 3 },
            SETTINGS,
        );
        expect(r.laborOutsourcingRatio).toBeNull();
        expect(r.outsourcingHeavy).toBe(false);
    });
});

describe('判定色', () => {
    const base = { sales: 1000000, cost: { laborCost: 200000, subcontractorCost: 0, totalCost: 300000 }, headcount: 10 };

    it('しきい値の100%以上で良好', () => {
        // 加工高 900,000 ÷ 10人 = 90,000 ≧ 40,000
        expect(computeValueAdded(base, SETTINGS).judgement).toBe('good');
    });

    it('しきい値の80〜100%で注意', () => {
        // 加工高 360,000 ÷ 10人 = 36,000（40,000の90%）
        const r = computeValueAdded({ ...base, sales: 460000 }, SETTINGS);
        expect(r.perManday).toBe(36000);
        expect(r.judgement).toBe('warning');
        expect(r.achievementRate).toBe(90);
    });

    it('しきい値の80%未満で要改善', () => {
        // 加工高 300,000 ÷ 10人 = 30,000（75%）
        const r = computeValueAdded({ ...base, sales: 400000 }, SETTINGS);
        expect(r.judgement).toBe('bad');
        expect(r.achievementRate).toBe(75);
    });

    it('しきい値が未設定なら判定しない', () => {
        const r = computeValueAdded(base, DEFAULT_VALUE_ADDED_SETTINGS);
        expect(r.judgement).toBe('unknown');
        expect(r.achievementRate).toBeNull();
        expect(r.perManday).toBe(90000); // 数値そのものは出す
    });

    it('外注中心の案件は労働生産性倍率で判定する', () => {
        // 山根様邸: 加工高60,000 / 人件費18,000 = 3.33倍。しきい値 40,000÷18,000 = 2.22倍
        const r = computeValueAdded(
            { sales: 225000, cost: { laborCost: 18000, subcontractorCost: 165000, totalCost: 183000 }, headcount: 1 },
            SETTINGS,
        );
        expect(r.judgedBy).toBe('productivity');
        expect(r.productivityRatio).toBeCloseTo(3.333, 3);
        expect(r.threshold).toBeCloseTo(2.222, 3);
        expect(r.judgement).toBe('good');
    });

    it('外注中心でなければ人工あたり加工高で判定する', () => {
        const r = computeValueAdded(base, SETTINGS);
        expect(r.judgedBy).toBe('perManday');
        expect(r.threshold).toBe(40000);
    });
});

describe('信頼度フラグ', () => {
    it('未請求は指標を出さない', () => {
        const r = computeValueAdded(
            { sales: 0, cost: { laborCost: 100000, subcontractorCost: 0, totalCost: 150000 }, headcount: 5 },
            SETTINGS,
        );
        expect(r.flags).toContain('no_sales');
        expect(r.available).toBe(false);
        expect(r.perManday).toBeNull();
        expect(valueAddedUnavailableReason(r)).toBe('未請求のため算出できません');
    });

    it('原価が0円なら原価未入力', () => {
        const r = computeValueAdded(
            { sales: 2028000, cost: { laborCost: 0, subcontractorCost: 0, totalCost: 0 }, headcount: 33 },
            SETTINGS,
        );
        expect(r.flags).toContain('no_cost');
        expect(valueAddedUnavailableReason(r)).toBe('原価未入力のため算出できません');
    });

    it('作業履歴があるのに人件費0なら原価未入力', () => {
        const r = computeValueAdded(
            {
                sales: 2028000,
                cost: { laborCost: 0, subcontractorCost: 0, totalCost: 10000 },
                headcount: 33,
                hasAssignments: true,
            },
            SETTINGS,
        );
        expect(r.flags).toContain('no_cost');
        expect(r.available).toBe(false);
    });

    it('総人数0なら自社人工なし', () => {
        const r = computeValueAdded(
            { sales: 500000, cost: { laborCost: 0, subcontractorCost: 300000, totalCost: 300000 }, headcount: 0 },
            SETTINGS,
        );
        expect(r.flags).toContain('no_manday');
        expect(valueAddedUnavailableReason(r)).toBe('自社人工がないため算出できません');
    });

    it('請求が見積の70%未満なら請求不足（数値は出すがグレー）', () => {
        // 松山市男女共同参画: 請求3,536,000 / 見積17,000,000 = 20.8%
        const r = computeValueAdded(
            {
                sales: 3536000,
                cost: { laborCost: 3477800, subcontractorCost: 0, totalCost: 3897919 },
                headcount: 185,
                estimateSubtotal: 17000000,
            },
            SETTINGS,
        );
        expect(r.flags).toContain('billing_short');
        expect(r.available).toBe(true);
        expect(r.tentative).toBe(true);
        expect(r.perManday).toBe(16842);
        expect(r.excludedFromAggregate).toBe(true);
    });

    it('請求が見積の70%以上なら請求不足にしない', () => {
        const r = computeValueAdded(
            {
                sales: 800000,
                cost: { laborCost: 100000, subcontractorCost: 0, totalCost: 200000 },
                headcount: 10,
                estimateSubtotal: 1000000,
            },
            SETTINGS,
        );
        expect(r.flags).not.toContain('billing_short');
        expect(r.tentative).toBe(false);
    });

    it('手動上書きは集計から除外する（数値は出す）', () => {
        const r = computeValueAdded(
            {
                sales: 1000000,
                cost: { laborCost: 200000, subcontractorCost: 0, totalCost: 300000 },
                headcount: 10,
                hasManualCost: true,
            },
            SETTINGS,
        );
        expect(r.flags).toContain('manual_override');
        expect(r.available).toBe(true);
        expect(r.excludedFromAggregate).toBe(true);
    });

    it('フラグが無ければ集計に含める', () => {
        const r = computeValueAdded(
            { sales: 1000000, cost: { laborCost: 200000, subcontractorCost: 0, totalCost: 300000 }, headcount: 10 },
            SETTINGS,
        );
        expect(r.flags).toEqual([]);
        expect(r.excludedFromAggregate).toBe(false);
    });
});

describe('端数', () => {
    it('円未満は切り捨てる', () => {
        const r = computeValueAdded(
            { sales: 100000, cost: { laborCost: 10000, subcontractorCost: 0, totalCost: 10001 }, headcount: 3 },
            SETTINGS,
        );
        // 加工高 99,999 ÷ 3 = 33,333
        expect(r.valueAdded).toBe(99999);
        expect(r.perManday).toBe(33333);
    });

    it('加工高が赤字でも計算する', () => {
        const r = computeValueAdded(
            { sales: 100000, cost: { laborCost: 50000, subcontractorCost: 200000, totalCost: 300000 }, headcount: 4 },
            SETTINGS,
        );
        expect(r.valueAdded).toBe(-150000);
        expect(r.perManday).toBe(-37500);
        expect(r.judgement).toBe('bad');
    });
});

describe('previewEstimateValueAdded（見積時の試算・仕様3-5）', () => {
    it('見積額と予定原価・予定人工から人工あたり加工高を出す', () => {
        // 加工高 = 1,200,000 − 200,000 = 1,000,000 ÷ 20人工 = 50,000
        const p = previewEstimateValueAdded(
            { sales: 1200000, nonLaborCost: 200000, plannedManDays: 20 },
            SETTINGS,
        );
        expect(p.valueAdded).toBe(1000000);
        expect(p.perManday).toBe(50000);
        expect(p.judgement).toBe('good');
        expect(p.achievementRate).toBe(125);
        // 足りているので逆算は出さない
        expect(p.requiredSales).toBeNull();
        expect(p.allowedManDays).toBeNull();
    });

    it('しきい値に届かないときは必要な見積額と許容人工を逆算する', () => {
        // 加工高 600,000 ÷ 20人工 = 30,000（しきい値40,000の75%）
        const p = previewEstimateValueAdded(
            { sales: 800000, nonLaborCost: 200000, plannedManDays: 20 },
            SETTINGS,
        );
        expect(p.perManday).toBe(30000);
        expect(p.judgement).toBe('bad');
        // 40,000 × 20 + 200,000 = 1,000,000
        expect(p.requiredSales).toBe(1000000);
        // 600,000 ÷ 40,000 = 15.0 人工
        expect(p.allowedManDays).toBe(15);
    });

    it('予定人工が0なら人工単価は出さない', () => {
        const p = previewEstimateValueAdded(
            { sales: 800000, nonLaborCost: 200000, plannedManDays: 0 },
            SETTINGS,
        );
        expect(p.perManday).toBeNull();
        expect(p.judgement).toBe('unknown');
        expect(p.requiredSales).toBeNull();
    });

    it('しきい値が未設定なら判定も逆算も出さない（数値は出す）', () => {
        const p = previewEstimateValueAdded(
            { sales: 800000, nonLaborCost: 200000, plannedManDays: 20 },
            DEFAULT_VALUE_ADDED_SETTINGS,
        );
        expect(p.perManday).toBe(30000);
        expect(p.judgement).toBe('unknown');
        expect(p.achievementRate).toBeNull();
        expect(p.requiredSales).toBeNull();
    });

    it('予定原価が見積額を超える（加工高が赤字）場合は許容人工0', () => {
        const p = previewEstimateValueAdded(
            { sales: 200000, nonLaborCost: 300000, plannedManDays: 5 },
            SETTINGS,
        );
        expect(p.valueAdded).toBe(-100000);
        expect(p.judgement).toBe('bad');
        expect(p.allowedManDays).toBe(0);
    });
});
