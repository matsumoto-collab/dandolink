// 原価計算ユーティリティ

export interface LaborSettings {
    laborDailyRate: number;      // 基本日当（円）
    standardWorkMinutes: number; // 標準労働時間（分）
}

export interface CostBreakdown {
    laborCost: number;           // 人件費
    loadingCost: number;         // 積込費（朝積込・夕積込）
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
 * 作業時間から人件費を計算
 * @param startTime 開始時間 (例: "08:00")
 * @param endTime 終了時間 (例: "17:00")
 * @param workerCount 作業者数
 * @param settings 日当設定
 */
export function calculateLaborCost(
    startTime: string | null | undefined,
    endTime: string | null | undefined,
    workerCount: number,
    settings: LaborSettings
): number {
    if (!startTime || !endTime) return 0;
    const { laborDailyRate, standardWorkMinutes } = settings;
    const minuteRate = laborDailyRate / standardWorkMinutes;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const workMinutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    return Math.round(workMinutes * workerCount * minuteRate);
}

/**
 * 積込時間から積込費を計算
 * @param morningMinutes 朝積込（分）
 * @param eveningMinutes 夕積込（分）
 * @param workerCount 作業者数
 * @param settings 日当設定
 */
export function calculateLoadingCost(
    morningMinutes: number,
    eveningMinutes: number,
    workerCount: number,
    settings: LaborSettings
): number {
    const { laborDailyRate, standardWorkMinutes } = settings;
    const minuteRate = laborDailyRate / standardWorkMinutes;
    const totalMinutes = morningMinutes + eveningMinutes;
    return Math.round(totalMinutes * workerCount * minuteRate);
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
    if (margin >= 30) return 'text-green-600';
    if (margin >= 20) return 'text-blue-600';
    if (margin >= 10) return 'text-yellow-600';
    if (margin >= 0) return 'text-orange-600';
    return 'text-red-600';
}
