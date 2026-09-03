/**
 * 受注明細書 API の共通処理（権限チェックと明細の DB 形への変換）。
 * route.ts ではないので Next.js のルートにはならない（同じ階層に置いて import するだけ）。
 */
import type { Prisma } from '@prisma/client';
import { errorResponse, requireAuth } from '@/lib/api/utils';
import type { OrderBacklogLinePayload } from '@/lib/validations/orderBacklog';

/**
 * 受注明細書は admin 専用（kei 決定）。
 *
 * 本番の User.role には大文字混在（'PARTNER' など）があるため、必ず小文字化して比較する。
 * `requireAdmin`（lib/api/utils）は大文字小文字をそのまま比較するのでここでは使わない。
 */
export async function requireOrderBacklogAdmin() {
    const { session, error } = await requireAuth();
    if (error) return { session: null, error };

    const role = (session!.user.role ?? '').toString().toLowerCase();
    if (role !== 'admin') {
        return { session: null, error: errorResponse('管理者権限が必要です', 403) };
    }
    return { session, error: null };
}

/** 検証済みの明細1行を OrderBacklogReportLine の作成データに直す。 */
export function toLineCreateData(
    line: OrderBacklogLinePayload,
    index: number,
): Omit<Prisma.OrderBacklogReportLineCreateManyInput, 'reportId'> {
    return {
        sortOrder: line.sortOrder ?? index,
        projectMasterId: line.projectMasterId ?? null,
        customerName: line.customerName,
        projectName: line.projectName,
        workKind: line.workKind,
        siteKind: line.siteKind,
        contractAmount: line.contractAmount,
        startYm: line.startYm ?? null,
        endYm: line.endYm ?? null,
        progressRate: line.progressRate,
        receivedAmount: line.receivedAmount,
        schedule: (line.schedule ?? {}) as Prisma.InputJsonValue,
        excluded: line.excluded,
        isManual: line.isManual,
        note: line.note ?? null,
    };
}

/** 基準日 'YYYY-MM-DD' → @db.Date に入れる Date（UTC 0時）。 */
export function toAsOfDate(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
}
