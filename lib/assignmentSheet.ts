/**
 * 手配表（紙の「作業日報」）の行データを組み立てる純粋関数。
 *
 * 画面の一覧表示（AssignmentListView）と PDF 出力（AssignmentSheetPDF）の
 * 両方がこのビルダーを使うことで、表示内容が常に一致するようにしている。
 * 並び順は「職長の表示順 → sortOrder」で、職長が変わるところでグループの
 * 区切り（foremanChanged）が立つ。担当（案件担当者）・作業員名簿・車両名の
 * 解決ロジックは従来の一覧表示と同一。
 */
import { formatDateKey } from '@/utils/employeeUtils';
import { isPartnerEntity, getPartnerCompanyName } from '@/lib/partnerHelpers';

/** 行の組み立てに必要な案件フィールドだけを構造的に定義（hook 実装に依存しない）。 */
export interface AssignmentSheetProject {
    id: string;
    startDate: string | Date;
    title: string;
    customer?: string | null;
    assignedEmployeeId?: string | null;
    constructionType?: string | null;
    color?: string | null;
    sortOrder?: number | null;
    createdBy?: string | string[] | null;
    confirmedWorkerIds?: string[] | null;
    workers?: string[] | null;
    confirmedVehicleIds?: string[] | null;
    vehicles?: string[] | null;
    /** 電動工具（Tool.id の配列。車両と違い名前ではなく ID で持つ） */
    tools?: string[] | null;
    confirmedToolIds?: string[] | null;
    memberCount?: number | null;
    meetingTime?: string | null;
    isDispatchConfirmed?: boolean | null;
}

/** workerNameMap の値（/api/dispatch/workers 由来）。 */
export interface WorkerNameInfo {
    displayName: string;
    isPartner: boolean;
    companyDisplayName: string | null;
    role: string | null;
}

export interface AssignmentSheetRow<T extends AssignmentSheetProject = AssignmentSheetProject> {
    /** 元の案件オブジェクト（クリックで詳細モーダルを開く等に使う）。 */
    project: T;
    projectId: string;
    /** 順番：職長グループ内の 1 始まりの連番。 */
    orderInGroup: number;
    /** 担当：案件担当者（姓のみ・複数は「・」連結）。未設定なら null。 */
    managerLabel: string | null;
    managerIds: string[];
    /** 元請会社名。 */
    customer: string;
    /** 現場名。 */
    title: string;
    foremanId: string | null;
    /** 職長名。 */
    foremanName: string;
    /** 作業員名簿（職長を除く・協力業者は「会社名 個人名」）。 */
    memberNames: string[];
    /** 人数。 */
    memberCount: number;
    /** 車両名（確定済みがあれば確定、なければ予定）。 */
    vehicleNames: string[];
    /** 電動工具名（確定済みがあれば確定、なければ予定）。 */
    toolNames: string[];
    /** 集合時間（任意）。 */
    meetingTime: string | null;
    /** 工事種別カラー（現場名等の文字色に使用）。 */
    color: string;
    isConfirmed: boolean;
    /** 担当者未設定（一覧では淡い赤背景で警告）。 */
    isUnassigned: boolean;
    /** 直前の行と同じ職長（一覧では「〃」表示）。 */
    sameForemanAsAbove: boolean;
    /** 直前の行から職長が変わった（グループ境界）。 */
    foremanChanged: boolean;
}

export interface BuildAssignmentSheetRowsParams<T extends AssignmentSheetProject> {
    projects: T[];
    /** 対象日（formatDateKey 済みの YYYY-MM-DD）。 */
    dateKey: string;
    /** 職長の表示順（カレンダーの表示順）。 */
    displayedForemanIds: string[];
    allForemen: { id: string; displayName: string }[];
    workerNameMap: Map<string, WorkerNameInfo>;
    vehicleNameMap: Map<string, string>;
    /** 電動工具 ID → 工具名。 */
    toolNameMap?: Map<string, string>;
    /** 案件担当者 ID → 表示名。 */
    managerMap: Map<string, string>;
    /** 工事種別 ID → { name, color }。 */
    ctMap: Map<string, { name: string; color: string }>;
    /** 名前マップの読み込み完了フラグ。false の間は名簿・車両を空にする。 */
    isNamesLoaded: boolean;
    /** 職長2 視点で「協力業者が班長の班」を丸ごと隠す。 */
    hidePartnerLedTeams?: boolean;
}

/** 案件担当者の表示名を姓のみに短縮する。 */
function shortManagerName(managerMap: Map<string, string>, id: string): string {
    const full = managerMap.get(id) || '';
    if (!full) return '';
    const parts = full.split(/[\s　]+/);
    return parts[0] || full;
}

export function buildAssignmentSheetRows<T extends AssignmentSheetProject>(
    params: BuildAssignmentSheetRowsParams<T>,
): AssignmentSheetRow<T>[] {
    const {
        projects,
        dateKey,
        displayedForemanIds,
        allForemen,
        workerNameMap,
        vehicleNameMap,
        toolNameMap,
        managerMap,
        ctMap,
        isNamesLoaded,
        hidePartnerLedTeams = false,
    } = params;

    const foremanOrder = new Map<string, number>();
    displayedForemanIds.forEach((id, idx) => foremanOrder.set(id, idx));

    const foremanNameById = new Map<string, string>();
    allForemen.forEach((f) => foremanNameById.set(f.id, f.displayName));

    // 当日の案件を抽出（職長2 視点では協力業者が班長の班を除外）
    const dayProjects = projects.filter((p) => {
        if (formatDateKey(new Date(p.startDate)) !== dateKey) return false;
        if (hidePartnerLedTeams && p.assignedEmployeeId) {
            const info = workerNameMap.get(p.assignedEmployeeId);
            if (isPartnerEntity(info)) return false;
        }
        return true;
    });

    // 職長の表示順 → sortOrder
    const sorted = [...dayProjects].sort((a, b) => {
        const aF = a.assignedEmployeeId ? (foremanOrder.get(a.assignedEmployeeId) ?? 9999) : 99999;
        const bF = b.assignedEmployeeId ? (foremanOrder.get(b.assignedEmployeeId) ?? 9999) : 99999;
        if (aF !== bF) return aF - bF;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    const rows: AssignmentSheetRow<T>[] = [];
    let orderInGroup = 0;

    sorted.forEach((p, idx) => {
        const prev = idx > 0 ? sorted[idx - 1] : null;
        const sameForemanAsAbove = !!(prev && prev.assignedEmployeeId && prev.assignedEmployeeId === p.assignedEmployeeId);
        const foremanChanged = !!(prev && prev.assignedEmployeeId !== p.assignedEmployeeId);
        orderInGroup = idx === 0 || foremanChanged ? 1 : orderInGroup + 1;

        const ctInfo = p.constructionType ? ctMap.get(p.constructionType) : null;
        const color = ctInfo?.color || p.color || '#475569';

        const managerIds = Array.isArray(p.createdBy) ? p.createdBy : p.createdBy ? [p.createdBy] : [];
        const managerLabel =
            managerIds.length === 0
                ? null
                : managerIds.length === 1
                  ? shortManagerName(managerMap, managerIds[0])
                  : managerIds.map((id) => shortManagerName(managerMap, id)).join('・');

        const vehicleNames = isNamesLoaded
            ? p.confirmedVehicleIds && p.confirmedVehicleIds.length > 0
                ? p.confirmedVehicleIds.map((id) => vehicleNameMap.get(id) || id)
                : (p.vehicles || []).map((id) => vehicleNameMap.get(id) || id)
            : [];

        // 電動工具は最初から Tool.id なので、マスタで名前に解決する（マスタに無ければ ID のまま）
        const toolNames = isNamesLoaded
            ? (p.confirmedToolIds && p.confirmedToolIds.length > 0 ? p.confirmedToolIds : (p.tools || []))
                .map((id) => toolNameMap?.get(id) || id)
            : [];

        const isVisibleMember = (id: string) => id !== p.assignedEmployeeId && workerNameMap.has(id);
        const formatMemberName = (id: string): string => {
            const info = workerNameMap.get(id)!;
            const company = getPartnerCompanyName(info);
            return company && company !== info.displayName ? `${company} ${info.displayName}` : info.displayName;
        };
        const memberNames = isNamesLoaded
            ? p.confirmedWorkerIds && p.confirmedWorkerIds.length > 0
                ? p.confirmedWorkerIds.filter(isVisibleMember).map(formatMemberName)
                : (p.workers || []).filter(isVisibleMember).map(formatMemberName)
            : [];

        rows.push({
            project: p,
            projectId: p.id,
            orderInGroup,
            managerLabel,
            managerIds,
            customer: p.customer || '',
            title: p.title,
            foremanId: p.assignedEmployeeId ?? null,
            foremanName: p.assignedEmployeeId ? foremanNameById.get(p.assignedEmployeeId) || '' : '',
            memberNames,
            memberCount: p.memberCount ?? 0,
            vehicleNames,
            toolNames,
            meetingTime: p.meetingTime ?? null,
            color,
            isConfirmed: !!p.isDispatchConfirmed,
            isUnassigned: !managerLabel,
            sameForemanAsAbove,
            foremanChanged,
        });
    });

    return rows;
}

/**
 * 確認欄に並べる担当者（姓）を、行の出現順で重複なく返す。
 * 紙の「確認 □今井 □三生 □竹内」に相当。
 */
export function getSheetManagers(
    rows: AssignmentSheetRow[],
    managerMap: Map<string, string>,
): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const r of rows) {
        for (const id of r.managerIds) {
            if (seen.has(id)) continue;
            seen.add(id);
            const short = shortManagerName(managerMap, id);
            if (short) names.push(short);
        }
    }
    return names;
}
