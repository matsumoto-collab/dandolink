import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { SALES_INVOICE_STATUSES, invoiceProjectShares } from '@/lib/profitDashboard';
import { loadValueAddedSettings } from '@/lib/valueAddedSettings';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import {
    buildOwnCrewVolume,
    emptyOwnCrewVolumeTotals,
    type OwnCrewVolumeAssignment,
    type OwnCrewVolumeProject,
} from '@/lib/ownCrewVolume';

export const dynamic = 'force-dynamic';

/** 協力業者ロール（自社職長ではない）。DB の role は大文字混在なので小文字で判定する */
const PARTNER_ROLES = new Set(['partner', 'partner_member']);

function isPartnerRole(role: string | null | undefined): boolean {
    return PARTNER_ROLES.has((role ?? '').toLowerCase());
}

/**
 * GET /api/own-crew-volume?year=2026&month=8&foremanId=<userId|all>
 *
 * 「自社班の出来高」（職長班 × 月の作業一覧）。協力業者出来高と同じ形で、自社の職長班が
 * その月に行った作業を 1 行ずつ並べ、外注換算・稼ぎ・人件費を出す。
 *
 * 計算は lib/ownCrewVolume.ts の純粋関数に閉じている。このルートは取得と受け渡しだけを行う。
 * 権限は requireManagerOrAbove（admin / manager のみ。職長・協力業者・税理士は 403）。
 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const sp = new URL(request.url).searchParams;
        const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const yearParam = Number(sp.get('year'));
        const monthParam = Number(sp.get('month'));
        const year = Number.isFinite(yearParam) && yearParam >= 2000 && yearParam <= 2100
            ? Math.trunc(yearParam)
            : nowJst.getUTCFullYear();
        const month = Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
            ? Math.trunc(monthParam)
            : nowJst.getUTCMonth() + 1;
        const foremanParam = sp.get('foremanId') ?? 'all';
        const foremanFilter = foremanParam && foremanParam !== 'all' ? foremanParam : null;

        // 月の JST 範囲（本番は UTC 稼働なので Date.UTC(..., -9) で JST 0 時を作る）
        const rangeStart = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0, 0));
        const rangeEnd = new Date(Date.UTC(year, month, 1, -9, 0, 0, 0));

        // 1) 表示月の配置（過去データは原価が無いので対象外）
        const monthAssignments = await prisma.projectAssignment.findMany({
            where: { date: { gte: rangeStart, lt: rangeEnd }, isBackfilled: false },
            select: {
                id: true, projectMasterId: true, assignedEmployeeId: true,
                date: true, constructionType: true, memberCount: true,
            },
        });

        const settingsPromise = Promise.all([
            prisma.systemSettings.findFirst(),
            loadValueAddedSettings(),
        ]);

        // 2) 職長のロールを引き、自社職長（partner / partner_member でない）の配置だけ残す
        const foremanIds = Array.from(new Set(monthAssignments.map(a => a.assignedEmployeeId).filter(Boolean)));
        const foremanUsers = foremanIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: foremanIds } },
                select: { id: true, displayName: true, role: true },
            })
            : [];
        const ownForemen = foremanUsers.filter(u => !isPartnerRole(u.role));
        const ownForemanNameById = new Map(ownForemen.map(u => [u.id, u.displayName]));

        const targetAssignments: OwnCrewVolumeAssignment[] = [];
        for (const a of monthAssignments) {
            const name = ownForemanNameById.get(a.assignedEmployeeId);
            if (name == null) continue;
            if (foremanFilter && a.assignedEmployeeId !== foremanFilter) continue;
            targetAssignments.push({
                assignmentId: a.id,
                foremanId: a.assignedEmployeeId,
                foremanName: name,
            });
        }

        // セレクタ用の職長リストは絞り込みに関わらず「その月に配置のある自社職長」全員
        const foremenWithAssignments = new Set(
            monthAssignments
                .map(a => a.assignedEmployeeId)
                .filter(id => ownForemanNameById.has(id)),
        );
        const foremen = ownForemen
            .filter(u => foremenWithAssignments.has(u.id))
            .map(u => ({ id: u.id, displayName: u.displayName }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

        const [systemSettings, valueAddedSettings] = await settingsPromise;
        const rates = {
            revenueRate: Number(systemSettings?.subcontractorRevenueRate ?? 60),
            assemblyRate: Number(systemSettings?.subcontractorAssemblyRate ?? 60),
            demolitionRate: Number(systemSettings?.subcontractorDemolitionRate ?? 40),
        };
        if (targetAssignments.length === 0) {
            return NextResponse.json(
                {
                    year, month, foremen, groups: [],
                    totals: emptyOwnCrewVolumeTotals(),
                    settings: { ...rates, breakevenPerManday: valueAddedSettings.breakevenPerManday },
                },
                { headers: { 'Cache-Control': 'no-store' } },
            );
        }

        // 3) 対象案件（表示月に自社班の配置がある案件）の原価・メタ・売上
        const targetAssignmentIds = new Set(targetAssignments.map(t => t.assignmentId));
        const projectIds = Array.from(new Set(
            monthAssignments
                .filter(a => targetAssignmentIds.has(a.id))
                .map(a => a.projectMasterId),
        ));

        const [costMap, projectMasters, estimates, allInvoices, constructionTypes] = await Promise.all([
            computeProjectCosts(projectIds, { withDetail: true }),
            prisma.projectMaster.findMany({
                where: { id: { in: projectIds } },
                select: {
                    id: true, title: true, name: true, honorific: true,
                    customerName: true, contractAmount: true, revenueOverride: true, createdBy: true,
                    subcontractorCosts: { select: { constructionTypeId: true, amount: true } },
                },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { projectMasterId: true, subtotal: true },
            }),
            // 売上は案件全体の確定請求（期間で切らない）。まとめ請求は明細のシェアで案件へ按分する
            prisma.invoice.findMany({
                where: { status: { in: [...SALES_INVOICE_STATUSES] }, isBackfilled: false },
                select: { subtotal: true, items: true, projectMasterId: true },
            }),
            prisma.constructionType.findMany({ select: { id: true, name: true } }),
        ]);

        const idSet = new Set(projectIds);
        const ctNameById = new Map(constructionTypes.map(c => [c.id, c.name]));

        const estimateSubtotalById = new Map<string, number>();
        for (const e of estimates) {
            if (!e.projectMasterId) continue;
            estimateSubtotalById.set(
                e.projectMasterId,
                (estimateSubtotalById.get(e.projectMasterId) ?? 0) + Number(e.subtotal),
            );
        }
        const invoiceSubtotalById = new Map<string, number>();
        for (const inv of allInvoices) {
            for (const [pid, share] of invoiceProjectShares(inv)) {
                if (share <= 0 || !idSet.has(pid)) continue;
                invoiceSubtotalById.set(pid, (invoiceSubtotalById.get(pid) ?? 0) + Number(inv.subtotal) * share);
            }
        }

        // 4) 案件担当者名（createdBy は JSON 配列。実データは1人だが複数なら先頭を代表にする）
        const assigneeIdByProject = new Map<string, string>();
        for (const pm of projectMasters) {
            const first = extractAssigneeIds(pm.createdBy ?? undefined)[0];
            if (first) assigneeIdByProject.set(pm.id, first);
        }
        const assigneeIds = Array.from(new Set(assigneeIdByProject.values()));
        const assigneeUsers = assigneeIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, displayName: true },
            })
            : [];
        const assigneeNameById = new Map(assigneeUsers.map(u => [u.id, u.displayName]));

        // 5) 常用（協力業者の人が自社班に入った）判定用: labor 行に出てくる作業者のロール
        const workerIds = new Set<string>();
        for (const pid of projectIds) {
            for (const r of costMap.get(pid)?.detail?.labor ?? []) {
                for (const wid of r.workerIds) workerIds.add(wid);
            }
        }
        const workerUsers = workerIds.size > 0
            ? await prisma.user.findMany({
                where: { id: { in: [...workerIds] } },
                select: { id: true, role: true },
            })
            : [];
        const partnerUserIds = workerUsers.filter(u => isPartnerRole(u.role)).map(u => u.id);

        const emptyBreakdown = {
            laborCost: 0, loadingCost: 0, vehicleCost: 0,
            materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
        };
        const projects: OwnCrewVolumeProject[] = projectMasters.map(pm => {
            const cost = costMap.get(pm.id);
            const laborRows = cost?.detail?.labor ?? [];
            const manualItems = cost?.detail?.manualItems;
            const hasManualCost =
                (manualItems
                    ? Object.values(manualItems).some(items => items.some(item => Number(item.amount) !== 0))
                    : false) ||
                laborRows.some(r => r.override != null) ||
                (cost?.detail?.vehicle ?? []).some(r => r.override != null) ||
                (cost?.detail?.subcontractor ?? []).some(r => r.override != null);
            const assigneeId = assigneeIdByProject.get(pm.id);
            return {
                projectMasterId: pm.id,
                projectTitle: pm.title || `${pm.name ?? ''}${pm.honorific ?? ''}`,
                customerName: pm.customerName,
                managerName: assigneeId ? assigneeNameById.get(assigneeId) ?? null : null,
                contractAmount: Number(pm.contractAmount ?? 0),
                revenueOverride: pm.revenueOverride,
                invoiceSubtotal: Math.round(invoiceSubtotalById.get(pm.id) ?? 0),
                estimateSubtotal: Math.round(estimateSubtotalById.get(pm.id) ?? 0),
                registeredSubcontractorCosts: pm.subcontractorCosts.map(c => ({
                    constructionTypeName: ctNameById.get(c.constructionTypeId) ?? null,
                    amount: Number(c.amount ?? 0),
                })),
                cost: cost?.breakdown ?? emptyBreakdown,
                laborRows,
                hasManualCost,
                // 表示月に配置がある案件だけを対象にしているので必ず true
                hasAssignments: true,
            };
        });

        const { groups, totals } = buildOwnCrewVolume({
            projects,
            assignments: targetAssignments,
            partnerUserIds,
            rates,
            settings: valueAddedSettings,
        });

        return NextResponse.json(
            {
                year, month, foremen, groups, totals,
                settings: { ...rates, breakevenPerManday: valueAddedSettings.breakevenPerManday },
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('自社班の出来高', error);
    }
}
