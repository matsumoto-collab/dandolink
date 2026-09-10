import { summarizeLaborProductivity, type LaborProductivityProject } from '@/lib/laborProductivity';
import { DEFAULT_VALUE_ADDED_SETTINGS, computeValueAdded } from '@/lib/valueAdded';

const SETTINGS = { ...DEFAULT_VALUE_ADDED_SETTINGS, breakevenPerManday: 40000 };

function project(params: {
    id: string;
    title?: string;
    content?: string | null;
    customer?: string | null;
    assigneeId?: string | null;
    assigneeName?: string | null;
    sales: number;
    laborCost: number;
    subcontractorCost?: number;
    totalCost: number;
    headcount: number;
    estimateSubtotal?: number;
    hasManualCost?: boolean;
}): LaborProductivityProject {
    return {
        projectMasterId: params.id,
        title: params.title ?? params.id,
        customerName: params.customer ?? null,
        constructionContent: params.content ?? null,
        assigneeId: params.assigneeId ?? null,
        assigneeName: params.assigneeName ?? null,
        valueAdded: computeValueAdded(
            {
                sales: params.sales,
                cost: {
                    laborCost: params.laborCost,
                    subcontractorCost: params.subcontractorCost ?? 0,
                    totalCost: params.totalCost,
                },
                headcount: params.headcount,
                estimateSubtotal: params.estimateSubtotal,
                hasManualCost: params.hasManualCost,
            },
            SETTINGS,
        ),
    };
}

describe('summarizeLaborProductivity', () => {
    it('区分ごとに加工高と総人数を合計し、人工あたり加工高を「合計÷合計」で出す', () => {
        const s = summarizeLaborProductivity(
            [
                // 加工高 900,000 / 10人
                project({ id: 'a', content: '大規模', sales: 1000000, laborCost: 200000, totalCost: 300000, headcount: 10 }),
                // 加工高 90,000 / 3人
                project({ id: 'b', content: '大規模', sales: 100000, laborCost: 20000, totalCost: 30000, headcount: 3 }),
            ],
            40000,
        );
        const group = s.byContent[0];
        expect(group.label).toBe('大規模');
        expect(group.projectCount).toBe(2);
        expect(group.valueAddedTotal).toBe(990000);
        expect(group.headcountTotal).toBe(13);
        // 案件ごとの平均(90,000と30,000の平均=60,000)ではなく、合計÷合計
        expect(group.perManday).toBe(76153);
    });

    it('1件あたり加工高と1件あたり人工を併記する', () => {
        const s = summarizeLaborProductivity(
            [
                project({ id: 'a', content: '大規模', sales: 5000000, laborCost: 500000, totalCost: 1000000, headcount: 80 }),
                project({ id: 'b', content: '新築', sales: 500000, laborCost: 100000, totalCost: 200000, headcount: 7 }),
            ],
            40000,
        );
        const large = s.byContent.find(g => g.label === '大規模')!;
        const house = s.byContent.find(g => g.label === '新築')!;
        // 加工高 = 5,000,000 −（1,000,000 − 500,000）= 4,500,000
        expect(large.valueAddedPerProject).toBe(4500000);
        expect(large.headcountPerProject).toBe(80);
        // 加工高 = 500,000 −（200,000 − 100,000）= 400,000
        expect(house.valueAddedPerProject).toBe(400000);
        expect(house.headcountPerProject).toBe(7);
        // 人工単価は大規模56,250 vs 新築57,142 でほぼ互角だが、1件あたりは11倍の差がある
        expect(large.perManday).toBe(56250);
        expect(house.perManday).toBe(57142);
    });

    it('フラグの付いた案件は集計から除き、理由の内訳を返す', () => {
        const s = summarizeLaborProductivity(
            [
                project({ id: 'ok', content: '改修', sales: 1000000, laborCost: 200000, totalCost: 300000, headcount: 10 }),
                // 未請求
                project({ id: 'nosales', content: '改修', sales: 0, laborCost: 100000, totalCost: 150000, headcount: 5 }),
                // 原価未入力
                project({ id: 'nocost', content: '改修', sales: 2028000, laborCost: 0, totalCost: 0, headcount: 33 }),
                // 請求不足
                project({ id: 'short', content: '改修', sales: 3536000, laborCost: 3477800, totalCost: 3897919, headcount: 185, estimateSubtotal: 17000000 }),
                // 手動上書き
                project({ id: 'manual', content: '改修', sales: 500000, laborCost: 100000, totalCost: 200000, headcount: 5, hasManualCost: true }),
            ],
            40000,
        );
        expect(s.includedCount).toBe(1);
        expect(s.excludedCount).toBe(4);
        const labels = s.excluded.map(e => e.label);
        expect(labels).toEqual(expect.arrayContaining(['未請求', '原価未入力', '請求不足の可能性', '手動入力']));
        // 集計は残った1件だけ
        expect(s.overall.projectCount).toBe(1);
        expect(s.overall.valueAddedTotal).toBe(900000);
    });

    it('しきい値を下回った案件を不足額の大きい順に並べる', () => {
        const s = summarizeLaborProductivity(
            [
                // 加工高 300,000 → 30,000円/人工 × 10人 → 不足 (40,000-30,000)*10 = 100,000
                project({ id: 'small', sales: 400000, laborCost: 100000, totalCost: 200000, headcount: 10 }),
                // 20,000円/人工 × 50人 → 不足 (40,000-20,000)*50 = 1,000,000
                project({ id: 'big', sales: 1000000, laborCost: 500000, totalCost: 500000, headcount: 50 }),
                // 良好なので入らない
                project({ id: 'good', sales: 1000000, laborCost: 100000, totalCost: 100000, headcount: 10 }),
            ],
            40000,
        );
        expect(s.shortfalls.map(x => x.projectMasterId)).toEqual(['big', 'small']);
        expect(s.shortfalls[0].shortfallTotal).toBe(1000000);
        expect(s.shortfalls[1].shortfallTotal).toBe(100000);
    });

    it('しきい値が未設定なら下位リストを作らない', () => {
        const s = summarizeLaborProductivity(
            [project({ id: 'a', sales: 400000, laborCost: 100000, totalCost: 100000, headcount: 10 })],
            null,
        );
        expect(s.shortfalls).toEqual([]);
        expect(s.threshold).toBeNull();
    });

    it('工事内容・顧客・担当者が未設定でも「未設定」でまとめる', () => {
        const s = summarizeLaborProductivity(
            [project({ id: 'a', sales: 1000000, laborCost: 200000, totalCost: 300000, headcount: 10 })],
            40000,
        );
        expect(s.byContent[0].label).toBe('未設定');
        expect(s.byCustomer[0].label).toBe('未設定');
        expect(s.byAssignee[0].label).toBe('未設定');
    });

    it('区分は加工高の大きい順に並べる', () => {
        const s = summarizeLaborProductivity(
            [
                project({ id: 'a', customer: '顧客A', sales: 200000, laborCost: 50000, totalCost: 100000, headcount: 5 }),
                project({ id: 'b', customer: '顧客B', sales: 2000000, laborCost: 500000, totalCost: 1000000, headcount: 30 }),
            ],
            40000,
        );
        expect(s.byCustomer.map(g => g.label)).toEqual(['顧客B', '顧客A']);
    });

    it('対象が0件でも落ちない', () => {
        const s = summarizeLaborProductivity([], 40000);
        expect(s.includedCount).toBe(0);
        expect(s.overall.perManday).toBeNull();
        expect(s.byContent).toEqual([]);
    });
});
