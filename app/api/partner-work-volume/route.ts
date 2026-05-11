import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';

const ADMIN_ROLES = ['admin', 'manager'];

export type PartnerWorkVolumeRowStatus = 'draft' | 'completed';

export interface PartnerWorkVolumeRow {
    /** DB id（保存済み行のみ）。未保存の自動生成行は null */
    id: string | null;
    partnerCompanyId: string;
    date: string; // YYYY-MM-DD (JST)
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

function parseYearMonth(year: string | null, month: string | null): { start: Date; end: Date } | null {
    if (!year || !month) return null;
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
    // @db.Date 列の比較は UTC 00:00 基準で行う（DATE は時刻を持たないため）
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    return { start, end };
}

function jstDateKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function jstDateOnly(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    // @db.Date 列に保存するため UTC 00:00 で固定（時刻を持たない DATE 型はタイムゾーンの影響を受けないようにする）
    return new Date(Date.UTC(y, m - 1, d));
}

function clampInt(value: unknown, max = 100_000_000): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(max, Math.round(n)));
}

function clampSortOrder(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-1_000_000, Math.min(1_000_000, Math.round(n)));
}

function normalizeStatus(value: unknown): PartnerWorkVolumeRowStatus {
    return value === 'completed' ? 'completed' : 'draft';
}

/**
 * GET /api/partner-work-volume?companyId=&year=YYYY&month=MM
 * 配置から自動生成された候補行と DB 保存済み行をマージして返す。
 * 月の monthStatus は「全行 completed && 行数 > 0」のときだけ 'completed'、それ以外は 'draft'。
 * partner は monthStatus === 'completed' のときのみ rows を取得できる。
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        const userId = session!.user.id as string;
        const userCompanyId = session!.user.companyId ?? null;

        const url = new URL(req.url);
        const queryCompanyId = url.searchParams.get('companyId');
        const range = parseYearMonth(url.searchParams.get('year'), url.searchParams.get('month'));
        if (!range) return validationErrorResponse('year/month が不正です');

        // 対象会社 ID を決定
        let partnerCompanyId: string | null = null;
        if (ADMIN_ROLES.includes(role)) {
            if (!queryCompanyId) return validationErrorResponse('companyId が必要です');
            partnerCompanyId = queryCompanyId;
        } else if (role === 'partner') {
            partnerCompanyId = userId;
        } else if (role === 'partner_member') {
            partnerCompanyId = userCompanyId;
        } else {
            return errorResponse('権限がありません', 403);
        }
        if (!partnerCompanyId) return errorResponse('協力会社が特定できません', 400);

        const partnerCompany = await prisma.user.findUnique({
            where: { id: partnerCompanyId },
            select: { id: true, role: true, displayName: true },
        });
        if (!partnerCompany || partnerCompany.role.toLowerCase() !== 'partner') {
            return errorResponse('協力会社が見つかりません', 404);
        }

        const isPartnerViewer = role === 'partner' || role === 'partner_member';

        // 会社所属メンバー
        const members = await prisma.user.findMany({
            where: { companyId: partnerCompanyId },
            select: { id: true },
        });
        const memberIds = new Set<string>(members.map((m) => m.id));
        memberIds.add(partnerCompanyId);

        // 月内の配置を取得
        const assignments = await prisma.projectAssignment.findMany({
            where: { date: { gte: range.start, lt: range.end } },
            select: {
                id: true,
                date: true,
                assignedEmployeeId: true,
                confirmedWorkerIds: true,
                constructionType: true,
                subcontractorCostOverride: true,
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        honorific: true,
                        customerShortName: true,
                        customerName: true,
                        createdBy: true,
                        managerIds: true,
                        subcontractorCosts: {
                            select: { constructionTypeId: true, amount: true },
                        },
                    },
                },
            },
            orderBy: [{ date: 'asc' }],
        });

        // 案件担当者 (createdBy: JSON 配列) と managerIds の両方を解決対象に
        const managerIdSet = new Set<string>();
        const createdByByPm = new Map<string, string[]>();
        for (const a of assignments) {
            const pm = a.projectMaster;
            const ids = parseJsonField<string[]>(pm.createdBy, []);
            createdByByPm.set(pm.id, ids);
            for (const id of ids) managerIdSet.add(id);
            for (const mid of pm.managerIds ?? []) managerIdSet.add(mid);
        }
        const managerUsers = await prisma.user.findMany({
            where: { id: { in: Array.from(managerIdSet) } },
            select: { id: true, displayName: true },
        });
        const managerMap = new Map(managerUsers.map((u) => [u.id, u.displayName]));

        const constructionTypes = await prisma.constructionType.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
        });
        const constructionTypeMap = new Map(constructionTypes.map((c) => [c.id, c.name]));

        // 協力会社が関与する配置のみフィルタ
        const relevantAssignments = assignments.filter((a) => {
            if (a.assignedEmployeeId === partnerCompanyId) return true;
            const confirmed = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            return confirmed.some((id) => memberIds.has(id));
        });

        // 自動生成 auto row 候補
        const autoRows = new Map<string, PartnerWorkVolumeRow>();
        for (const a of relevantAssignments) {
            const pm = a.projectMaster;
            const projectTitle = pm.name ? `${pm.name}${pm.honorific ?? ''}` : pm.title;
            const customerName = pm.customerShortName || pm.customerName || null;
            const createdByIds = createdByByPm.get(pm.id) ?? [];
            const managerSourceIds = createdByIds.length > 0 ? createdByIds : (pm.managerIds ?? []);
            const managerName = managerSourceIds
                .map((id) => managerMap.get(id))
                .filter(Boolean)
                .join('、') || null;
            const constructionContent = a.constructionType
                ? constructionTypeMap.get(a.constructionType) ?? null
                : null;
            let amount = 0;
            if (a.subcontractorCostOverride != null) {
                amount = a.subcontractorCostOverride;
            } else if (a.constructionType) {
                const sc = pm.subcontractorCosts.find(
                    (c) => c.constructionTypeId === a.constructionType
                );
                if (sc) amount = Math.round(Number(sc.amount));
            }
            autoRows.set(a.id, {
                id: null,
                partnerCompanyId,
                date: jstDateKey(a.date),
                customerName,
                projectMasterId: pm.id,
                projectTitle,
                managerName,
                constructionContent,
                amount,
                sourceAssignmentId: a.id,
                isManual: false,
                sortOrder: 0,
                notes: null,
                status: 'draft',
                isAuto: true,
            });
        }

        // 保存済み行
        const saved = await prisma.partnerWorkVolume.findMany({
            where: {
                partnerCompanyId,
                date: { gte: range.start, lt: range.end },
            },
        });

        const merged: PartnerWorkVolumeRow[] = [];
        const usedAssignmentIds = new Set<string>();
        let latestCompletedAt: Date | null = null;
        for (const row of saved) {
            if (row.sourceAssignmentId) usedAssignmentIds.add(row.sourceAssignmentId);
            if (row.completedAt && (!latestCompletedAt || row.completedAt > latestCompletedAt)) {
                latestCompletedAt = row.completedAt;
            }
            merged.push({
                id: row.id,
                partnerCompanyId: row.partnerCompanyId,
                date: jstDateKey(row.date),
                customerName: row.customerName,
                projectMasterId: row.projectMasterId,
                projectTitle: row.projectTitle,
                managerName: row.managerName,
                constructionContent: row.constructionContent,
                amount: row.amount,
                sourceAssignmentId: row.sourceAssignmentId,
                isManual: row.isManual,
                sortOrder: row.sortOrder,
                notes: row.notes,
                status: normalizeStatus(row.status),
                isAuto: !!row.sourceAssignmentId,
            });
        }
        // まだ保存されていない自動行
        for (const [assignmentId, row] of autoRows) {
            if (usedAssignmentIds.has(assignmentId)) continue;
            merged.push(row);
        }

        // 月の自動公開判定: 行数 > 0 かつ全行 completed
        const totalRows = merged.length;
        const completedCount = merged.filter((r) => r.status === 'completed').length;
        const monthStatus: PartnerWorkVolumeRowStatus =
            totalRows > 0 && completedCount === totalRows ? 'completed' : 'draft';

        // partner / partner_member は monthStatus === 'completed' のときのみ閲覧可
        if (isPartnerViewer && monthStatus !== 'completed') {
            return NextResponse.json(
                {
                    partnerCompany: { id: partnerCompany.id, displayName: partnerCompany.displayName },
                    rows: [],
                    monthStatus,
                    completedAt: null,
                    totalRows,
                    completedCount,
                },
                { headers: { 'Cache-Control': 'no-store' } }
            );
        }

        // 並び替え: 日付昇順 → sortOrder → 自動行を先に
        merged.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            if (!!a.sourceAssignmentId !== !!b.sourceAssignmentId) {
                return a.sourceAssignmentId ? -1 : 1;
            }
            return 0;
        });

        return NextResponse.json(
            {
                partnerCompany: { id: partnerCompany.id, displayName: partnerCompany.displayName },
                rows: merged,
                monthStatus,
                completedAt:
                    monthStatus === 'completed' && latestCompletedAt
                        ? latestCompletedAt.toISOString()
                        : null,
                totalRows,
                completedCount,
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (err) {
        return serverErrorResponse('協力会社出来高取得', err);
    }
}

interface UpsertBody {
    id?: string | null;
    partnerCompanyId: string;
    date: string; // YYYY-MM-DD
    customerName?: string | null;
    projectMasterId?: string | null;
    projectTitle: string;
    managerName?: string | null;
    constructionContent?: string | null;
    amount?: number;
    sourceAssignmentId?: string | null;
    isManual?: boolean;
    sortOrder?: number;
    notes?: string | null;
    status?: PartnerWorkVolumeRowStatus;
}

/**
 * POST /api/partner-work-volume
 * 1行を upsert（admin / manager のみ）
 * - id がある場合 → update
 * - sourceAssignmentId がある場合 → そのキーで upsert
 * - どちらもない場合 → 新規作成（手動行）
 *
 * status を含めると、completedAt/completedBy も併せて更新される。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!ADMIN_ROLES.includes(role)) {
            return errorResponse('管理者またはマネージャー権限が必要です', 403);
        }

        const body = (await req.json()) as UpsertBody;
        if (!body || !body.partnerCompanyId || !body.date || !body.projectTitle) {
            return validationErrorResponse('partnerCompanyId / date / projectTitle が必要です');
        }
        const dateOnly = jstDateOnly(body.date);
        if (!dateOnly) return validationErrorResponse('date が不正です（YYYY-MM-DD）');

        const userId = session!.user.id as string;
        const now = new Date();
        const statusUpdate = body.status !== undefined
            ? {
                  status: normalizeStatus(body.status),
                  completedAt: normalizeStatus(body.status) === 'completed' ? now : null,
                  completedBy: normalizeStatus(body.status) === 'completed' ? userId : null,
              }
            : {};

        const data = {
            partnerCompanyId: body.partnerCompanyId,
            date: dateOnly,
            customerName: body.customerName?.trim() || null,
            projectMasterId: body.projectMasterId ?? null,
            projectTitle: body.projectTitle.trim(),
            managerName: body.managerName?.trim() || null,
            constructionContent: body.constructionContent?.trim() || null,
            amount: clampInt(body.amount),
            sortOrder: clampSortOrder(body.sortOrder),
            notes: body.notes?.trim() || null,
            updatedBy: userId,
            ...statusUpdate,
        };

        let saved;
        if (body.id) {
            saved = await prisma.partnerWorkVolume.update({
                where: { id: body.id },
                data,
            });
        } else if (body.sourceAssignmentId) {
            saved = await prisma.partnerWorkVolume.upsert({
                where: { sourceAssignmentId: body.sourceAssignmentId },
                update: data,
                create: {
                    ...data,
                    sourceAssignmentId: body.sourceAssignmentId,
                    isManual: false,
                },
            });
        } else {
            saved = await prisma.partnerWorkVolume.create({
                data: {
                    ...data,
                    isManual: true,
                },
            });
        }

        return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('協力会社出来高保存', err);
    }
}
