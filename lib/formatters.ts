/**
 * API レスポンス用フォーマット関数
 * 各APIルートで重複していたフォーマット関数を統一
 */

import { parseJsonField } from '@/lib/json-utils';

// ============================================
// 型定義
// ============================================

/** 配置レコードの生データ型 */
export interface RawAssignment {
    id: string;
    date: Date;
    workers: string | null;
    vehicles: string | null;
    confirmedWorkerIds: string | null;
    confirmedVehicleIds: string | null;
    createdAt: Date;
    updatedAt: Date;
    projectMaster?: RawProjectMasterBase | null;
    assignmentWorkers?: Array<{ workerName: string; workerId?: string | null }>;
    assignmentVehicles?: Array<{ vehicleName: string; vehicleId?: string | null }>;
    // Optional fields present in schema
    memberCount?: number;
    remarks?: string | null;
    isDispatchConfirmed?: boolean;
    [key: string]: unknown;
}

/** 案件マスターの基本生データ型 */
export interface RawProjectMasterBase {
    id: string;
    title: string;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
}

/** 案件マスターの生データ型（配置含む） */
export interface RawProjectMaster extends RawProjectMasterBase {
    assemblyDate?: Date | null;
    demolitionDate?: Date | null;
    assignments?: RawAssignment[];
}

/** 見積の生データ型 */
export interface RawEstimate {
    id: string;
    estimateNumber: string;
    title: string;
    items: string | null;
    validUntil: Date;
    createdAt: Date;
    updatedAt: Date;
    subtotal?: unknown;
    tax?: unknown;
    total?: unknown;
    [key: string]: unknown;
}

/** 請求書の生データ型 */
export interface RawInvoice {
    id: string;
    invoiceNumber: string;
    title: string;
    items: string | null;
    dueDate: Date;
    paidDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
}

// ============================================
// フォーマット関数
// ============================================

/**
 * 配置レコードをAPIレスポンス用にフォーマット
 * - Date → ISO文字列
 * - JSON文字列 → パース済み配列
 * - 新テーブル（assignmentWorkers/Vehicles）があればそちらを優先
 */
export function formatAssignment(a: RawAssignment) {
    // 新リレーションが存在する場合は、そこから名前のリストを生成
    // 存在しない（未移行）場合は、既存のJSONフィールドを使用
    const workers = a.assignmentWorkers && a.assignmentWorkers.length > 0
        ? a.assignmentWorkers.map(w => w.workerName)
        : parseJsonField<string[]>(a.workers, []);

    const vehicles = a.assignmentVehicles && a.assignmentVehicles.length > 0
        ? a.assignmentVehicles.map(v => v.vehicleName)
        : parseJsonField<string[]>(a.vehicles, []);

    return {
        ...a,
        date: a.date.toISOString(),
        workers,
        vehicles,
        confirmedWorkerIds: parseJsonField<string[]>(a.confirmedWorkerIds, []),
        confirmedVehicleIds: parseJsonField<string[]>(a.confirmedVehicleIds, []),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        projectMaster: a.projectMaster ? formatProjectMasterBase(a.projectMaster) : null,
    };
}

/**
 * 案件マスターの基本フォーマット（配置なし）
 */
function formatProjectMasterBase(pm: RawProjectMasterBase) {
    return {
        ...pm,
        createdBy: parseJsonField<string[] | null>(pm.createdBy, null),
        createdAt: pm.createdAt.toISOString(),
        updatedAt: pm.updatedAt.toISOString(),
    };
}

/**
 * 案件マスターをAPIレスポンス用にフォーマット
 * - Date → ISO文字列
 * - JSON文字列 → パース済み配列
 * - ネストされた配置もフォーマット
 */
export function formatProjectMaster(pm: RawProjectMaster) {
    return {
        ...pm,
        createdBy: parseJsonField<string[] | null>(pm.createdBy, null),
        createdAt: pm.createdAt.toISOString(),
        updatedAt: pm.updatedAt.toISOString(),
        assemblyDate: pm.assemblyDate?.toISOString() || null,
        demolitionDate: pm.demolitionDate?.toISOString() || null,
        assignments: pm.assignments?.map(a => formatAssignment(a as RawAssignment)),
    };
}

/**
 * 見積をAPIレスポンス用にフォーマット
 * - items: JSON文字列 → パース済み配列
 * - validUntil: Date → ISO文字列
 */
export function formatEstimate(estimate: RawEstimate) {
    return {
        ...estimate,
        subtotal: Number(estimate.subtotal || 0),
        tax: Number(estimate.tax || 0),
        total: Number(estimate.total || 0),
        items: parseJsonField<unknown[]>(estimate.items, []),
        validUntil: estimate.validUntil.toISOString(),
        createdAt: estimate.createdAt.toISOString(),
        updatedAt: estimate.updatedAt.toISOString(),
    };
}

/**
 * 請求書をAPIレスポンス用にフォーマット
 * - items: JSON文字列 → パース済み配列
 * - dueDate, paidDate: Date → ISO文字列
 */
export function formatInvoice(invoice: RawInvoice) {
    return {
        ...invoice,
        subtotal: Number((invoice as Record<string, unknown>).subtotal || 0),
        tax: Number((invoice as Record<string, unknown>).tax || 0),
        total: Number((invoice as Record<string, unknown>).total || 0),
        items: parseJsonField<unknown[]>(invoice.items, []),
        dueDate: invoice.dueDate.toISOString(),
        paidDate: invoice.paidDate?.toISOString() || null,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
    };
}
