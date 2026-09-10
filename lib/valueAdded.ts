/**
 * 「人工あたり加工高」の計算。
 *
 * 職人は月給制で人件費は固定費なので、案件の良し悪しは利益率ではなく
 * 「投入した1人工あたりいくら残したか」で見る。人件費は引かない。
 *
 *   加工高           = 売上（確定請求・税抜） − 人件費以外の原価
 *   人工あたり加工高 = 加工高 ÷ 総人数
 *   労働生産性倍率   = 加工高 ÷ 自社人件費
 *   労務の外注比率   = 外注費 ÷（外注費 ＋ 自社人件費）
 *
 * 分母の「総人数」は利益サマリーに出ている実績ベースの人数（原価計上した作業者の実数）を
 * そのまま使う。手配時の予定人数(memberCount)ではない＝人件費と分母の定義を揃えるため。
 *
 * 労務の外注比率の分母を売上ではなく「労務の合計」にしているのは、この比率を
 * 「人工あたり加工高を信用してよいか」の判定にだけ使うため（kei決定 2026-09-10）。
 * 自社がほとんど行っていない現場は人工単価が跳ね上がるので、そこに「外注中心」バッジを出し、
 * 判定色は按分後の実額を分母にする労働生産性倍率のほうで付ける。
 */
import type { CostBreakdown } from '@/utils/costCalculation';

export type ValueAddedFlag =
    | 'no_sales'
    | 'no_cost'
    | 'no_manday'
    | 'billing_short'
    | 'manual_override'
    | 'outsourcing_heavy';

export type ValueAddedJudgement = 'good' | 'warning' | 'bad' | 'unknown';

export const VALUE_ADDED_FLAG_LABELS: Record<ValueAddedFlag, string> = {
    no_sales: '未請求',
    no_cost: '原価未入力',
    no_manday: '自社人工なし',
    billing_short: '請求不足の可能性',
    manual_override: '手動入力',
    outsourcing_heavy: '外注中心',
};

export const VALUE_ADDED_JUDGEMENT_LABELS: Record<ValueAddedJudgement, string> = {
    good: '良好',
    warning: '注意',
    bad: '要改善',
    unknown: '判定なし',
};

export interface ValueAddedSettings {
    /** 損益分岐の人工単価（自社情報に手入力）。未設定は判定しない */
    breakevenPerManday: number | null;
    /** 「外注中心」と判定する労務の外注比率 */
    outsourcingRatioThreshold: number;
    /** 請求不足を疑う 請求額÷見積額 */
    billingShortRatio: number;
    /** 黄色（注意）判定の下限 */
    judgeWarningRatio: number;
    /** 人件費の日額。労働生産性倍率のしきい値（＝損益分岐人工単価÷日額）に使う */
    laborDailyRate: number;
}

export const DEFAULT_VALUE_ADDED_SETTINGS: ValueAddedSettings = {
    breakevenPerManday: null,
    outsourcingRatioThreshold: 0.5,
    billingShortRatio: 0.7,
    judgeWarningRatio: 0.8,
    laborDailyRate: 18000,
};

export interface ValueAddedInput {
    /** 確定売上（請求・税抜）。未請求は0 */
    sales: number;
    cost: Pick<CostBreakdown, 'laborCost' | 'subcontractorCost' | 'totalCost'>;
    /** 総人数（利益サマリーと同じ実績ベース＝原価計上した作業者の延べ人数） */
    headcount: number;
    /** 見積(税抜)。請求不足の判定に使う。0/未指定なら判定しない */
    estimateSubtotal?: number;
    /** 原価が手動で上書きされているか */
    hasManualCost?: boolean;
    /** 作業履歴（配置）があるか。「原価未入力」の判定に使う */
    hasAssignments?: boolean;
}

export interface ValueAddedResult {
    sales: number;
    laborCost: number;
    subcontractorCost: number;
    /** 人件費以外の原価（車両費＋材料費＋外注費＋積込費＋その他） */
    nonLaborCost: number;
    valueAdded: number;
    headcount: number;
    /** 人工あたり加工高。分母0や指標を出せない場合は null */
    perManday: number | null;
    /** 労働生産性倍率（加工高÷自社人件費） */
    productivityRatio: number | null;
    /** 労務の外注比率（外注費÷(外注費+人件費)） */
    laborOutsourcingRatio: number | null;
    outsourcingHeavy: boolean;
    flags: ValueAddedFlag[];
    /** 指標を数値で出せるか */
    available: boolean;
    /** 数値は出すが確度が低い（グレー表示） */
    tentative: boolean;
    judgement: ValueAddedJudgement;
    /** 判定に使った指標。外注中心の案件は労働生産性倍率で判定する */
    judgedBy: 'perManday' | 'productivity' | null;
    /** 判定に使ったしきい値（perManday なら円、productivity なら倍率） */
    threshold: number | null;
    /** しきい値に対する達成率(%)。しきい値未設定は null */
    achievementRate: number | null;
    /** ダッシュボードの平均から除外すべきか */
    excludedFromAggregate: boolean;
}

/** 円未満切り捨て（0方向）。負の加工高でも絶対値が増えないようにする */
function truncYen(value: number): number {
    return Math.trunc(value);
}

function judgeBy(
    value: number | null,
    threshold: number | null,
    warningRatio: number,
): ValueAddedJudgement {
    if (value === null || threshold === null || !(threshold > 0)) return 'unknown';
    if (value >= threshold) return 'good';
    if (value >= threshold * warningRatio) return 'warning';
    return 'bad';
}

export function computeValueAdded(
    input: ValueAddedInput,
    settings: ValueAddedSettings = DEFAULT_VALUE_ADDED_SETTINGS,
): ValueAddedResult {
    const sales = Math.round(input.sales || 0);
    const laborCost = Math.round(input.cost.laborCost || 0);
    const subcontractorCost = Math.round(input.cost.subcontractorCost || 0);
    const totalCost = Math.round(input.cost.totalCost || 0);
    const headcount = Math.max(0, Math.floor(input.headcount || 0));
    const estimateSubtotal = Math.round(input.estimateSubtotal || 0);

    const nonLaborCost = totalCost - laborCost;
    const valueAdded = truncYen(sales - nonLaborCost);

    const laborTotal = subcontractorCost + laborCost;
    const laborOutsourcingRatio = laborTotal > 0 ? subcontractorCost / laborTotal : null;
    const outsourcingHeavy =
        laborOutsourcingRatio !== null && laborOutsourcingRatio > settings.outsourcingRatioThreshold;

    const flags: ValueAddedFlag[] = [];
    if (sales <= 0) flags.push('no_sales');
    // 原価が1円も無い、または作業履歴があるのに人件費が0＝入力漏れ
    if (totalCost === 0 || (laborCost === 0 && input.hasAssignments)) flags.push('no_cost');
    if (headcount <= 0) flags.push('no_manday');
    if (estimateSubtotal > 0 && sales > 0 && sales < estimateSubtotal * settings.billingShortRatio) {
        flags.push('billing_short');
    }
    if (input.hasManualCost) flags.push('manual_override');
    if (outsourcingHeavy) flags.push('outsourcing_heavy');

    const available =
        !flags.includes('no_sales') && !flags.includes('no_cost') && !flags.includes('no_manday');
    const tentative = flags.includes('billing_short');

    const perManday = available && headcount > 0 ? truncYen(valueAdded / headcount) : null;
    const productivityRatio = laborCost > 0 ? valueAdded / laborCost : null;

    // 外注中心の案件は自社人工が少なく人工単価が跳ね上がるため、労働生産性倍率で判定する
    const judgedBy: ValueAddedResult['judgedBy'] = !available
        ? null
        : outsourcingHeavy
            ? 'productivity'
            : 'perManday';

    let threshold: number | null = null;
    let judged: number | null = null;
    if (judgedBy === 'perManday') {
        threshold = settings.breakevenPerManday;
        judged = perManday;
    } else if (judgedBy === 'productivity') {
        // 損益分岐の人工単価 ÷ 人件費の日額 ＝ 人件費1円あたり必要な加工高
        threshold =
            settings.breakevenPerManday !== null && settings.laborDailyRate > 0
                ? settings.breakevenPerManday / settings.laborDailyRate
                : null;
        judged = productivityRatio;
    }

    const judgement = judgeBy(judged, threshold, settings.judgeWarningRatio);
    const achievementRate =
        judged !== null && threshold !== null && threshold > 0
            ? Math.round((judged / threshold) * 100)
            : null;

    return {
        sales,
        laborCost,
        subcontractorCost,
        nonLaborCost,
        valueAdded,
        headcount,
        perManday,
        productivityRatio,
        laborOutsourcingRatio,
        outsourcingHeavy,
        flags,
        available,
        tentative,
        judgement,
        judgedBy,
        threshold,
        achievementRate,
        // 平均を歪めるものは集計から外す（原価未入力・請求不足・手動上書き・未請求・人工なし）
        excludedFromAggregate: !available || tentative || flags.includes('manual_override'),
    };
}

export interface EstimateValueAddedPreview {
    valueAdded: number;
    perManday: number | null;
    judgement: ValueAddedJudgement;
    achievementRate: number | null;
    /** しきい値を満たすのに必要な見積額（税抜）。今の見積で足りていれば null */
    requiredSales: number | null;
    /** 今の見積額でしきい値を満たすために収める必要がある人工。足りていれば null */
    allowedManDays: number | null;
}

/**
 * 見積書作成時の試算（仕様3-5）。
 * 実績ではなく「予定」で計算する: 売上＝見積額、原価＝人件費以外の予定原価、
 * 人工＝予定組立人工＋予定解体人工。信頼度フラグや外注中心の判定は使わない
 * （まだ配置も請求も無いため）。
 */
export function previewEstimateValueAdded(
    params: { sales: number; nonLaborCost: number; plannedManDays: number },
    settings: ValueAddedSettings = DEFAULT_VALUE_ADDED_SETTINGS,
): EstimateValueAddedPreview {
    const sales = Math.round(params.sales || 0);
    const nonLaborCost = Math.round(params.nonLaborCost || 0);
    const planned = Math.max(0, params.plannedManDays || 0);

    const valueAdded = truncYen(sales - nonLaborCost);
    const perManday = planned > 0 ? truncYen(valueAdded / planned) : null;
    const threshold = settings.breakevenPerManday;
    const judgement = judgeBy(perManday, threshold, settings.judgeWarningRatio);
    const achievementRate =
        perManday !== null && threshold !== null && threshold > 0
            ? Math.round((perManday / threshold) * 100)
            : null;

    let requiredSales: number | null = null;
    let allowedManDays: number | null = null;
    if (threshold !== null && threshold > 0 && perManday !== null && perManday < threshold) {
        // しきい値 × 予定人工 ＋ 人件費以外の原価 ＝ 必要な見積額
        requiredSales = Math.ceil(threshold * planned + nonLaborCost);
        // 今の加工高でしきい値を満たせる人工（小数第1位まで）
        allowedManDays = valueAdded > 0 ? Math.floor((valueAdded / threshold) * 10) / 10 : 0;
    }

    return { valueAdded, perManday, judgement, achievementRate, requiredSales, allowedManDays };
}

/** 指標を数値で出せない理由（画面にそのまま出す文言）。出せる場合は null */
export function valueAddedUnavailableReason(result: ValueAddedResult): string | null {
    if (result.available) return null;
    if (result.flags.includes('no_sales')) return '未請求のため算出できません';
    if (result.flags.includes('no_cost')) return '原価未入力のため算出できません';
    if (result.flags.includes('no_manday')) return '自社人工がないため算出できません';
    return '算出できません';
}
