/**
 * 受注明細書の保存済みデータ（prisma）を、純粋ロジック（render / buckets）が受け取る形に直す。
 * API と Excel 出力の両方から使うので、DB の行 → 入力形の変換はここに一本化する。
 * （lib/orderBacklog の他のファイルは prisma を import しない。ここだけがサーバー専用）
 */
import type { OrderBacklogReport, OrderBacklogReportLine } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
    OrderBacklogLineInput,
    OrderBacklogReportInput,
    ScheduleMap,
    SiteKind,
    TaxMode,
    UnreceivedMode,
    WorkKind,
} from './types';

/** 保存済みレポートのヘッダー（API のレスポンスにもこの形で出す）。 */
export interface OrderBacklogReportRecord extends OrderBacklogReportInput {
    id: string;
    createdById: string | null;
    createdByName: string | null;
    createdAt: string;
    updatedAt: string;
}

const SCHEDULE_KEY = /^(\d{4}-\d{2}|later)$/;

/** Json 列の入金予定を ScheduleMap に。壊れたキー・数値でない値は捨てる（画面が落ちないように）。 */
export function toScheduleMap(value: unknown): ScheduleMap {
    const out: ScheduleMap = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
        if (!SCHEDULE_KEY.test(key)) continue;
        const n = typeof amount === 'number' ? amount : Number(amount);
        if (!Number.isFinite(n)) continue;
        out[key] = Math.round(n);
    }
    return out;
}

export function toLineInput(row: OrderBacklogReportLine): OrderBacklogLineInput {
    return {
        id: row.id,
        projectMasterId: row.projectMasterId,
        customerName: row.customerName,
        projectName: row.projectName,
        workKind: (row.workKind === 'new' ? 'new' : 'temp') as WorkKind,
        siteKind: (row.siteKind === 'house' ? 'house' : 'other') as SiteKind,
        contractAmount: row.contractAmount,
        startYm: row.startYm,
        endYm: row.endYm,
        progressRate: row.progressRate,
        receivedAmount: row.receivedAmount,
        schedule: toScheduleMap(row.schedule),
        excluded: row.excluded,
        isManual: row.isManual,
        note: row.note,
        sortOrder: row.sortOrder,
    };
}

export function toReportRecord(row: OrderBacklogReport): OrderBacklogReportRecord {
    return {
        id: row.id,
        // @db.Date は UTC 0時で入っているので、そのまま YYYY-MM-DD に切る
        asOfDate: row.asOfDate.toISOString().slice(0, 10),
        title: row.title,
        applicantName: row.applicantName,
        individualThreshold: row.individualThreshold,
        unreceivedMode: (row.unreceivedMode === 'unpaid' ? 'unpaid' : 'remaining') as UnreceivedMode,
        taxMode: (row.taxMode === 'exclusive' ? 'exclusive' : 'inclusive') as TaxMode,
        notes: row.notes,
        createdById: row.createdById,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/** レポート1件を明細つきで読む。無ければ null。明細は sortOrder 順。 */
export async function loadOrderBacklogReport(
    id: string,
): Promise<{ report: OrderBacklogReportRecord; lines: OrderBacklogLineInput[] } | null> {
    const row = await prisma.orderBacklogReport.findUnique({
        where: { id },
        include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (!row) return null;
    return { report: toReportRecord(row), lines: row.lines.map(toLineInput) };
}
