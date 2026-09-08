import type { Customer } from '@/types/customer';

export interface ResolvedEstimateCustomer {
    name: string;
    honorific: string;
}

const DEFAULT_HONORIFIC = '御中';

/**
 * 見積書PDFの宛名（顧客名・敬称）を解決する。
 *
 * 優先順位:
 *   1. 見積書自身の customerId（フォームで案件と別の顧客に変更・保存できる）
 *   2. 紐づく案件(ProjectMaster)の customerId
 *   3. 案件に残る顧客名のスナップショット（customerName / customerShortName）
 *   4. 空文字
 *
 * 1・2 は顧客マスタの現在値で名前・敬称を引くため、顧客名の変更にも追従する。
 * 見積書一覧・見積フォームのプレビューは 1 を使っているので、PDF もこれに揃える。
 */
export function resolveEstimateCustomer(params: {
    estimateCustomerId?: string | null;
    projectCustomerId?: string | null;
    customers: ReadonlyArray<Pick<Customer, 'id' | 'name' | 'honorific'>>;
    fallbackName?: string | null;
    fallbackHonorific?: string | null;
}): ResolvedEstimateCustomer {
    const { estimateCustomerId, projectCustomerId, customers, fallbackName, fallbackHonorific } = params;
    const find = (id?: string | null) => (id ? customers.find(c => c.id === id) : undefined);
    const cust = find(estimateCustomerId) ?? find(projectCustomerId);
    if (cust) return { name: cust.name, honorific: cust.honorific || DEFAULT_HONORIFIC };
    return { name: fallbackName || '', honorific: fallbackHonorific || DEFAULT_HONORIFIC };
}

/**
 * 案件から組み立てた Project の宛名を、見積書自身の顧客名・敬称で上書きする（見積詳細モーダル用）。
 * 見積書の顧客名が空なら案件の宛名をそのまま使う（同じ参照を返す）。現場名などは変えない。
 */
export function applyEstimateCustomerToProject<T extends { customer?: string; customerHonorific?: string }>(
    project: T,
    customerName?: string | null,
    customerHonorific?: string | null,
): T {
    if (!customerName) return project;
    return { ...project, customer: customerName, customerHonorific: customerHonorific || DEFAULT_HONORIFIC };
}
