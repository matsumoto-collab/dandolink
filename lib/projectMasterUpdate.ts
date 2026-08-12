import type { ProjectMaster, ScaffoldingSpec } from '@/types/calendar';
import type { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';

/**
 * 案件詳細モーダル（ProjectMasterDetailModal）の保存処理の共通部。
 * 案件一覧（project-masters/page.tsx）と請求待ちボード（billing-board/page.tsx）で共用する。
 */

/** フォーム入力 → updateProjectMaster へ渡すペイロード（null 明示でクリア可能） */
export function buildProjectMasterUpdatePayload(data: ProjectMasterFormData): Partial<ProjectMaster> {
    const subcontractorCosts = data.subcontractorCosts
        .filter(r => r.constructionTypeId && r.amount !== '')
        .map(r => {
            const amount = Number(r.amount);
            const tc = r.transportCost === '' ? null : Number(r.transportCost);
            return {
                constructionTypeId: r.constructionTypeId,
                amount,
                transportCost: tc != null && Number.isFinite(tc) && tc >= 0 ? tc : null,
            };
        })
        .filter(r => Number.isFinite(r.amount) && r.amount >= 0);

    // null を送ることで API 側でフィールドをクリアできる（undefined だと更新対象外になる）
    const updatePayload: Record<string, unknown> = {
        title: data.title,
        name: data.name || null,
        honorific: data.honorific ?? null,
        constructionSuffixId: data.constructionSuffixId || null,
        siteShortName: data.siteShortName || null,
        customerId: data.customerId || null,
        customerName: data.customerName || null,
        constructionContent: (data.constructionContent as string) || null,
        postalCode: data.postalCode || null,
        prefecture: data.prefecture || null,
        city: data.city || null,
        location: data.location || null,
        plusCode: data.plusCode || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        area: data.area ? parseFloat(data.area) : null,
        areaRemarks: data.areaRemarks || null,
        estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : null,
        estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : null,
        contractAmount: data.contractAmount ? parseInt(data.contractAmount) : null,
        scaffoldingSpec: data.scaffoldingSpec as ScaffoldingSpec,
        remarks: data.remarks ?? '',
        createdBy: data.createdBy.length > 0 ? data.createdBy : [],
        subcontractorCosts,
    };

    return updatePayload as Partial<ProjectMaster>;
}
