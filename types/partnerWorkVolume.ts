export type PartnerWorkVolumeRowStatus = 'draft' | 'completed';
export type PartnerWorkVolumeMonthStatus = 'draft' | 'completed';
/** 行の費目区分。'work' = 作業費、'transport' = 運搬費。 */
export type PartnerWorkVolumeRowType = 'work' | 'transport';

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
    /** 同じ配置に対して作業費の行と運搬費の行を区別するためのキー */
    rowType: PartnerWorkVolumeRowType;
    isManual: boolean;
    sortOrder: number;
    notes: string | null;
    /** 行ごとの完了ステータス。未保存 auto 行は常に 'draft' */
    status: PartnerWorkVolumeRowStatus;
    /** 自動生成由来か（保存済みでも sourceAssignmentId があれば true） */
    isAuto: boolean;
    /** 論理削除日時。null = 削除されていない。値あり = tombstone（GET 通常モードでは返らない） */
    deletedAt: string | null;
    /** ユーザーが明示的に amount を入力したか。true のとき amount=0 でも案件マスタから再算出されない */
    amountOverridden: boolean;
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
