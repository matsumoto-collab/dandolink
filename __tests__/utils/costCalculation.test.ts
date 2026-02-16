import {
    calculateLaborCost,
    calculateLoadingCost,
    calculateProfitSummary,
    formatCurrency,
    getProfitMarginColor,
    LaborSettings,
    CostBreakdown,
} from '@/utils/costCalculation';

describe('costCalculation', () => {
    const defaultSettings: LaborSettings = {
        laborDailyRate: 15000,      // 日当15,000円
        standardWorkMinutes: 480,   // 8時間 = 480分
    };

    describe('calculateLaborCost', () => {
        it('作業時間と人数から人件費を計算する', () => {
            // 08:00-16:00 = 480分 × 1人 × (15000/480) = 15000円
            const cost = calculateLaborCost('08:00', '16:00', 1, defaultSettings);
            expect(cost).toBe(15000);
        });

        it('複数人の場合は人数分加算される', () => {
            // 08:00-16:00 = 480分 × 3人 × (15000/480) = 45000円
            const cost = calculateLaborCost('08:00', '16:00', 3, defaultSettings);
            expect(cost).toBe(45000);
        });

        it('半日分の計算ができる', () => {
            // 08:00-12:00 = 240分 × 1人 × (15000/480) = 7500円
            const cost = calculateLaborCost('08:00', '12:00', 1, defaultSettings);
            expect(cost).toBe(7500);
        });

        it('端数は四捨五入される', () => {
            // 08:00-09:40 = 100分 × 1人 × (15000/480) ≈ 3125円
            const cost = calculateLaborCost('08:00', '09:40', 1, defaultSettings);
            expect(cost).toBe(3125);
        });

        it('startTimeがnullの場合は0', () => {
            const cost = calculateLaborCost(null, '16:00', 1, defaultSettings);
            expect(cost).toBe(0);
        });

        it('endTimeがnullの場合は0', () => {
            const cost = calculateLaborCost('08:00', null, 1, defaultSettings);
            expect(cost).toBe(0);
        });
    });

    describe('calculateLoadingCost', () => {
        it('朝夕の積込時間から積込費を計算する', () => {
            // (30 + 30)分 × 2人 × (15000/480) = 3750円
            const cost = calculateLoadingCost(30, 30, 2, defaultSettings);
            expect(cost).toBe(3750);
        });

        it('朝のみの積込', () => {
            // 60分 × 1人 × (15000/480) = 1875円
            const cost = calculateLoadingCost(60, 0, 1, defaultSettings);
            expect(cost).toBe(1875);
        });

        it('夕のみの積込', () => {
            // 45分 × 1人 × (15000/480) ≈ 1406円
            const cost = calculateLoadingCost(0, 45, 1, defaultSettings);
            expect(cost).toBe(1406);
        });
    });

    describe('calculateProfitSummary', () => {
        const costBreakdown: CostBreakdown = {
            laborCost: 30000,
            loadingCost: 5000,
            vehicleCost: 10000,
            materialCost: 15000,
            subcontractorCost: 0,
            otherExpenses: 5000,
            totalCost: 65000,
        };

        it('粗利を計算する', () => {
            const summary = calculateProfitSummary(100000, 120000, costBreakdown);
            expect(summary.grossProfit).toBe(35000); // 100000 - 65000
        });

        it('利益率を計算する', () => {
            const summary = calculateProfitSummary(100000, 120000, costBreakdown);
            expect(summary.profitMargin).toBe(35); // 35000/100000 * 100 = 35%
        });

        it('売上0の場合は利益率0', () => {
            const summary = calculateProfitSummary(0, 0, costBreakdown);
            expect(summary.profitMargin).toBe(0);
        });

        it('赤字の場合は負の利益率', () => {
            const summary = calculateProfitSummary(50000, 60000, costBreakdown);
            expect(summary.grossProfit).toBe(-15000);
            expect(summary.profitMargin).toBe(-30);
        });
    });

    describe('formatCurrency', () => {
        it('日本円形式でフォーマットする', () => {
            expect(formatCurrency(10000)).toBe('￥10,000');
        });

        it('0円をフォーマットする', () => {
            expect(formatCurrency(0)).toBe('￥0');
        });

        it('大きな金額をフォーマットする', () => {
            expect(formatCurrency(1234567)).toBe('￥1,234,567');
        });

        it('負の金額をフォーマットする', () => {
            expect(formatCurrency(-5000)).toBe('-￥5,000');
        });
    });

    describe('getProfitMarginColor', () => {
        it('30%以上は緑', () => {
            expect(getProfitMarginColor(30)).toBe('text-green-600');
            expect(getProfitMarginColor(50)).toBe('text-green-600');
        });

        it('20-30%は青', () => {
            expect(getProfitMarginColor(20)).toBe('text-blue-600');
            expect(getProfitMarginColor(29)).toBe('text-blue-600');
        });

        it('10-20%は黄', () => {
            expect(getProfitMarginColor(10)).toBe('text-yellow-600');
            expect(getProfitMarginColor(19)).toBe('text-yellow-600');
        });

        it('0-10%はオレンジ', () => {
            expect(getProfitMarginColor(0)).toBe('text-orange-600');
            expect(getProfitMarginColor(9)).toBe('text-orange-600');
        });

        it('負の値は赤', () => {
            expect(getProfitMarginColor(-1)).toBe('text-red-600');
            expect(getProfitMarginColor(-50)).toBe('text-red-600');
        });
    });
});
