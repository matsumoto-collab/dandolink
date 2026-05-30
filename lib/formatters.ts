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
    assignments?: RawAssignment[];
    _count?: { assignments: number };
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
    costTotal?: number | null;
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
    const rec = pm as Record<string, unknown>;
    const numOrNull = (v: unknown): number | null => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const subcontractorCostsRaw = rec.subcontractorCosts as Array<Record<string, unknown>> | undefined;
    const subcontractorCosts = Array.isArray(subcontractorCostsRaw)
        ? subcontractorCostsRaw.map(c => ({
            id: String(c.id ?? ''),
            constructionTypeId: String(c.constructionTypeId ?? ''),
            amount: numOrNull(c.amount) ?? 0,
            transportCost: numOrNull(c.transportCost),
            sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : 0,
        }))
        : undefined;

    return {
        ...pm,
        createdBy: parseJsonField<string[] | null>(pm.createdBy, null),
        createdAt: pm.createdAt.toISOString(),
        updatedAt: pm.updatedAt.toISOString(),
        materialCost: numOrNull(rec.materialCost),
        otherExpenses: numOrNull(rec.otherExpenses),
        subcontractorCosts,
        assignments: pm.assignments?.map(a => formatAssignment(a as RawAssignment)),
        assignmentCount: pm._count?.assignments ?? pm.assignments?.length ?? 0,
    };
}

/**
 * 案件マスターのレスポンスから金額情報を除去する
 * 管理者・マネージャー以外には金額面を伏せるため
 */
export function stripProjectMasterFinancials<T extends Record<string, unknown>>(pm: T): T {
    const {
        contractAmount: _ca,
        materialCost: _mc,
        otherExpenses: _oe,
        subcontractorCosts: _sc,
        ...rest
    } = pm as Record<string, unknown>;
    // Suppress unused-variable warnings while keeping destructure-to-strip pattern
    void _ca; void _mc; void _oe; void _sc;
    return rest as T;
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
        costTotal: estimate.costTotal ?? null,
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

/**
 * 請求予定（BillingDraft）を API レスポンス用にフォーマット
 * - items: JSON 文字列 → パース済み配列（InvoiceItem[] 相当。null/未設定は []）
 *
 * Decimal（amount/taxRate）と Date（createdAt 等）は NextResponse.json の
 * 既定シリアライズに委ねる（items 以外は既存挙動を維持）。
 */
export function formatBillingDraft<T extends { items: string | null }>(draft: T) {
    return {
        ...draft,
        items: parseJsonField<unknown[]>(draft.items, []),
    };
}
