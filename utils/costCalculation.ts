// 原価計算ユーティリティ

export interface LaborSettings {
    laborDailyRate: number;      // 基本日当（円）
    standardWorkMinutes: number; // 標準労働時間（分）
}

export interface CostBreakdown {
    laborCost: number;           // 人件費
    loadingCost: number;         // 積込費（廃止: 常に0）
    vehicleCost: number;         // 車両費
    materialCost: number;        // 材料費
    subcontractorCost: number;   // 外注費
    otherExpenses: number;       // その他経費
    totalCost: number;           // 合計原価
}

export interface ProfitSummary {
    revenue: number;             // 売上（請求金額）
    estimateAmount: number;      // 見積金額
    costBreakdown: CostBreakdown;
    grossProfit: number;         // 粗利
    profitMargin: number;        // 利益率（%）
}

/**
 * 利益サマリーを計算
 */
export function calculateProfitSummary(
    revenue: number,
    estimateAmount: number,
    costBreakdown: CostBreakdown
): ProfitSummary {
    const grossProfit = revenue - costBreakdown.totalCost;
    const profitMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    return {
        revenue,
        estimateAmount,
        costBreakdown,
        grossProfit,
        profitMargin: Math.round(profitMargin * 10) / 10, // 小数点1桁
    };
}

/**
 * 金額をフォーマット
 */
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('ja-JP', {
        style: 'currency',
        currency: 'JPY',
        maximumFractionDigits: 0,
    }).format(amount);
}

/**
 * 利益率に応じた色クラスを返す
 */
export function getProfitMarginColor(margin: number): string {
    if (margin >= 30) return 'text-slate-800';
    if (margin >= 20) return 'text-slate-700';
    if (margin >= 10) return 'text-slate-600';
    if (margin >= 0) return 'text-slate-500';
    return 'text-slate-400';
}
