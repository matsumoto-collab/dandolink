export type PartnerWorkVolumeRowStatus = 'draft' | 'completed';
export type PartnerWorkVolumeMonthStatus = 'draft' | 'completed';

export interface PartnerWorkVolumeRow {
    /** DB id（保存済み行のみ）。未保存の自動生成行は null */
    id: string | null;
    partnerCompanyId: string;
    /** YYYY-MM-DD (JST) */
    date: string;
    customerName: string | null;
    projectMasterId: string | null;
    projectTitle: string;
    managerName: string | null;
    constructionContent: string | null;
    amount: number;
    sourceAssignmentId: string | null;
    isManual: boolean;
    sortOrder: number;
    notes: string | null;
    /** 行ごとの完了ステータス。未保存 auto 行は常に 'draft' */
    status: PartnerWorkVolumeRowStatus;
    /** 自動生成由来か（保存済みでも sourceAssignmentId があれば true） */
    isAuto: boolean;
}

export interface PartnerWorkVolumeResponse {
    partnerCompany: {
        id: string;
        displayName: string;
    };
    rows: PartnerWorkVolumeRow[];
    monthStatus: PartnerWorkVolumeMonthStatus;
    completedAt: string | null;
    totalRows: number;
    completedCount: number;
}

export interface PartnerCompanyOption {
    id: string;
    displayName: string;
}
