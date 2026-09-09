/**
 * 協力業者費（予定）が現在の売上と釣り合っているかの判定。
 *
 * 予定単価は案件登録画面の「組立・解体を自動計算」で
 *   売上(税抜) × 協力業者率 → 組立按分率 / 解体按分率
 * から作られるが、その後に見積金額が変わっても再計算されない。
 * ここでは同じ式で「目安」を出し直し、現在の予定単価とのずれを検出する（警告表示のみ）。
 *
 * 計算式は components/ProjectMasters/sections/SubcontractorCostSection.tsx の
 * handleAutoCalc と同一。式を変えるときは両方を必ず揃えること。
 */

/** システム設定の按分率（すべて %）。 */
export interface SubcontractorRates {
    /** 協力業者率（売上比） */
    revenueRate: number;
    /** 組立按分率 */
    assemblyRate: number;
    /** 解体按分率 */
    demolitionRate: number;
}

export interface SubcontractorCostCheckInput {
    /** 税抜売上。0以下・非数値は判定不能（unknown） */
    revenue: number;
    rates: SubcontractorRates;
    /** 現在の予定単価。作業費のみを渡す（運搬費は自動計算の対象外なので含めない） */
    costs: Array<{ constructionTypeName: string; amount: number }>;
}

export interface SubcontractorCostCheckResult {
    /**
     * ok      … 目安と釣り合っている
     * stale   … 目安から閾値を超えてずれている（＝売上変更後に再計算されていない疑い）
     * none    … 予定単価が1件も入っていない（警告しない）
     * unknown … 売上・按分率が決まらず判定できない（警告しない）
     */
    status: 'ok' | 'stale' | 'none' | 'unknown';
    /** 目安の合計（未丸め。表示時は Math.round する） */
    expectedTotal: number;
    /** 目安の組立（自動計算と同じく丸め済み） */
    expectedAssembly: number;
    /** 目安の解体（自動計算と同じく丸め済み） */
    expectedDemolition: number;
    /** 現在の予定単価の合計（全工事種別の作業費） */
    currentTotal: number;
    /** currentTotal - Math.round(expectedTotal) */
    diff: number;
}

/** ずれの許容幅: 目安の1%、ただし最低1,000円。 */
function tolerance(expectedTotal: number): number {
    return Math.max(1000, expectedTotal * 0.01);
}

function toFiniteNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

export function checkSubcontractorCostStale(
    input: SubcontractorCostCheckInput,
): SubcontractorCostCheckResult {
    // 現在の合計（マイナスや非数値は0扱い＝入力途中で警告が暴れないようにする）
    const currentTotal = input.costs.reduce((sum, c) => {
        const amount = toFiniteNumber(c.amount);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);

    const revenue = toFiniteNumber(input.revenue);
    const revenueRate = toFiniteNumber(input.rates?.revenueRate);
    const assemblyRate = toFiniteNumber(input.rates?.assemblyRate);
    const demolitionRate = toFiniteNumber(input.rates?.demolitionRate);

    const empty = { expectedTotal: 0, expectedAssembly: 0, expectedDemolition: 0 };

    // 売上や率が決まらないときは目安を出せない＝判定不能
    if (
        !Number.isFinite(revenue) || revenue <= 0 ||
        !Number.isFinite(revenueRate) || !Number.isFinite(assemblyRate) || !Number.isFinite(demolitionRate)
    ) {
        // 目安が出せないので diff は currentTotal そのもの（expectedTotal=0 との差）
        return { status: 'unknown', ...empty, currentTotal, diff: currentTotal };
    }

    const expectedTotal = revenue * revenueRate / 100;
    const expectedAssembly = Math.round(expectedTotal * assemblyRate / 100);
    const expectedDemolition = Math.round(expectedTotal * demolitionRate / 100);
    const diff = currentTotal - Math.round(expectedTotal);

    // 未入力（＝自動計算をまだ使っていない）は警告の対象外
    if (currentTotal <= 0) {
        return { status: 'none', expectedTotal, expectedAssembly, expectedDemolition, currentTotal, diff };
    }

    const status = Math.abs(diff) > tolerance(expectedTotal) ? 'stale' : 'ok';
    return { status, expectedTotal, expectedAssembly, expectedDemolition, currentTotal, diff };
}

/** 売上の区分ラベル（profit API の revenueSource と同じ値）。 */
export function revenueSourceLabel(source: string | undefined | null): string {
    switch (source) {
        case 'invoice': return '請求済み';
        case 'estimate': return '見積';
        case 'contract': return '契約金額';
        case 'override': return '手動上書き';
        default: return '売上';
    }
}
