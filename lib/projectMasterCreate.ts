import type { ProjectMaster, ScaffoldingSpec } from '@/types/calendar';
import type { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';

/**
 * 新規案件登録（ProjectMasterCreateModal）の保存処理の共通部。
 * 案件一覧（project-masters/page.tsx）と見積書一覧（estimates/page.tsx の「案件を作成」）で共用する。
 */

/** フォーム入力 → createProjectMaster へ渡すペイロード */
export function buildProjectMasterCreatePayload(
    data: ProjectMasterFormData
): Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'> {
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

    return {
        title: data.title,
        name: data.name || undefined,
        honorific: data.honorific ?? undefined,
        constructionSuffixId: data.constructionSuffixId || undefined,
        siteShortName: data.siteShortName || undefined,
        customerId: data.customerId || undefined,
        customerName: data.customerName || undefined,
        constructionType: 'other',
        constructionContent: data.constructionContent as string,
        status: 'active',
        postalCode: data.postalCode || undefined,
        prefecture: data.prefecture || undefined,
        city: data.city || undefined,
        location: data.location || undefined,
        plusCode: data.plusCode || undefined,
        latitude: data.latitude ?? undefined,
        longitude: data.longitude ?? undefined,
        area: data.area ? parseFloat(data.area) : undefined,
        areaRemarks: data.areaRemarks || undefined,
        estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : undefined,
        estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : undefined,
        contractAmount: data.contractAmount ? parseInt(data.contractAmount) : undefined,
        scaffoldingSpec: data.scaffoldingSpec as ScaffoldingSpec,
        remarks: data.remarks || undefined,
        createdBy: data.createdBy.length > 0 ? data.createdBy : undefined,
        subcontractorCosts,
    } as Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'>;
}

/**
 * 作業日程リスト（workDates）から配置を自動生成する。
 * 職長未選択の行はスキップ（配置を作らない。'unassigned' の孤児配置を生まないため）。
 */
export async function createAssignmentsFromWorkDates(
    projectMasterId: string,
    workDates: ProjectMasterFormData['workDates']
): Promise<void> {
    const assignmentPromises = workDates.flatMap((w) => {
        if (!w.date || w.foremen.length === 0) return [];
        return w.foremen.map((f, i) =>
            fetch('/api/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectMasterId,
                    assignedEmployeeId: f.foremanId,
                    date: new Date(`${w.date}T00:00:00Z`).toISOString(),
                    memberCount: f.memberCount,
                    sortOrder: i,
                    estimatedHours: 8.0,
                    constructionType: w.constructionType || undefined,
                }),
            })
        );
    });
    await Promise.all(assignmentPromises);
}
