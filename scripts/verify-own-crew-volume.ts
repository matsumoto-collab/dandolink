/**
 * 「自社班の出来高」を本番データで検算する。**読み取り（SELECT）のみ**。
 *
 *   npx tsx scripts/verify-own-crew-volume.ts 2026 8
 *
 * 見るもの:
 *  1. 案件ごとに「全 labor 行（全月・全班）の稼ぎ合計 = 案件の稼ぎ V」が成り立つか（切り捨て誤差は行数未満）
 *  2. 表示月の合計（人工・外注換算・稼ぎ・人件費）と、そこから出る 3 つの指標
 */
export {};

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

const PARTNER_ROLES = new Set(['partner', 'partner_member']);
const isPartnerRole = (role: string | null | undefined) => PARTNER_ROLES.has((role ?? '').toLowerCase());

async function main() {
    const year = Number(process.argv[2]) || 2026;
    const month = Number(process.argv[3]) || 8;

    const { prisma } = await import('../lib/prisma');
    const { computeProjectCosts } = await import('../lib/projectCost');
    const { SALES_INVOICE_STATUSES, invoiceProjectShares } = await import('../lib/profitDashboard');
    const { loadValueAddedSettings } = await import('../lib/valueAddedSettings');
    const { extractAssigneeIds } = await import('../lib/projectAssignees');
    const { buildOwnCrewVolume, computeProjectEarnings } = await import('../lib/ownCrewVolume');

    try {
        const rangeStart = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0, 0));
        const rangeEnd = new Date(Date.UTC(year, month, 1, -9, 0, 0, 0));
        console.log(`=== 自社班の出来高 ${year}年${month}月 ===`);

        const monthAssignments = await prisma.projectAssignment.findMany({
            where: { date: { gte: rangeStart, lt: rangeEnd }, isBackfilled: false },
            select: { id: true, projectMasterId: true, assignedEmployeeId: true },
        });
        const foremanIds = Array.from(new Set(monthAssignments.map(a => a.assignedEmployeeId).filter(Boolean)));
        const foremanUsers = foremanIds.length > 0
            ? await prisma.user.findMany({ where: { id: { in: foremanIds } }, select: { id: true, displayName: true, role: true } })
            : [];
        const ownForemanNameById = new Map(
            foremanUsers.filter(u => !isPartnerRole(u.role)).map(u => [u.id, u.displayName]),
        );
        const assignments = monthAssignments
            .filter(a => ownForemanNameById.has(a.assignedEmployeeId))
            .map(a => ({
                assignmentId: a.id,
                foremanId: a.assignedEmployeeId,
                foremanName: ownForemanNameById.get(a.assignedEmployeeId)!,
            }));
        console.log(`配置: 全 ${monthAssignments.length} 件 / 自社班 ${assignments.length} 件 / 職長 ${ownForemanNameById.size} 名`);
        if (assignments.length === 0) {
            console.log('この月に自社班の配置はありません。');
            return;
        }

        const targetIds = new Set(assignments.map(a => a.assignmentId));
        const projectIds = Array.from(new Set(
            monthAssignments.filter(a => targetIds.has(a.id)).map(a => a.projectMasterId),
        ));
        console.log(`対象案件: ${projectIds.length} 件`);

        const [costMap, projectMasters, estimates, allInvoices, constructionTypes, systemSettings, vaSettings] =
            await Promise.all([
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
                prisma.invoice.findMany({
                    where: { status: { in: [...SALES_INVOICE_STATUSES] }, isBackfilled: false },
                    select: { subtotal: true, items: true, projectMasterId: true },
                }),
                prisma.constructionType.findMany({ select: { id: true, name: true } }),
                prisma.systemSettings.findFirst(),
                loadValueAddedSettings(),
            ]);

        const idSet = new Set(projectIds);
        const ctNameById = new Map(constructionTypes.map(c => [c.id, c.name]));
        const estimateSubtotalById = new Map<string, number>();
        for (const e of estimates) {
            if (!e.projectMasterId) continue;
            estimateSubtotalById.set(e.projectMasterId, (estimateSubtotalById.get(e.projectMasterId) ?? 0) + Number(e.subtotal));
        }
        const invoiceSubtotalById = new Map<string, number>();
        for (const inv of allInvoices) {
            for (const [pid, share] of invoiceProjectShares(inv)) {
                if (share <= 0 || !idSet.has(pid)) continue;
                invoiceSubtotalById.set(pid, (invoiceSubtotalById.get(pid) ?? 0) + Number(inv.subtotal) * share);
            }
        }

        const assigneeIdByProject = new Map<string, string>();
        for (const pm of projectMasters) {
            const first = extractAssigneeIds(pm.createdBy ?? undefined)[0];
            if (first) assigneeIdByProject.set(pm.id, first);
        }
        const assigneeUsers = assigneeIdByProject.size > 0
            ? await prisma.user.findMany({
                where: { id: { in: Array.from(new Set(assigneeIdByProject.values())) } },
                select: { id: true, displayName: true },
            })
            : [];
        const assigneeNameById = new Map(assigneeUsers.map(u => [u.id, u.displayName]));

        const workerIds = new Set<string>();
        for (const pid of projectIds) {
            for (const r of costMap.get(pid)?.detail?.labor ?? []) for (const wid of r.workerIds) workerIds.add(wid);
        }
        const workerUsers = workerIds.size > 0
            ? await prisma.user.findMany({ where: { id: { in: [...workerIds] } }, select: { id: true, role: true } })
            : [];
        const partnerUserIds = workerUsers.filter(u => isPartnerRole(u.role)).map(u => u.id);

        const rates = {
            revenueRate: Number(systemSettings?.subcontractorRevenueRate ?? 60),
            assemblyRate: Number(systemSettings?.subcontractorAssemblyRate ?? 60),
            demolitionRate: Number(systemSettings?.subcontractorDemolitionRate ?? 40),
        };
        const emptyBreakdown = {
            laborCost: 0, loadingCost: 0, vehicleCost: 0,
            materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0,
        };
        const projects = projectMasters.map(pm => {
            const cost = costMap.get(pm.id);
            const laborRows = cost?.detail?.labor ?? [];
            const manualItems = cost?.detail?.manualItems;
            const hasManualCost =
                (manualItems ? Object.values(manualItems).some(items => items.some(it => Number(it.amount) !== 0)) : false) ||
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
                hasAssignments: true,
            };
        });

        // ---- 1) 案件ごと: 全 labor 行の稼ぎ合計 = 案件の稼ぎ V ----
        let matched = 0, skipped = 0;
        const mismatches: string[] = [];
        for (const p of projects) {
            const e = computeProjectEarnings(p, vaSettings);
            if (e.valueAdded == null || e.headcount === 0) { skipped++; continue; }
            const sum = p.laborRows.reduce(
                (s, r) => s + Math.trunc(e.valueAdded! / e.headcount * (r.workerCount || 0)), 0,
            );
            const diff = e.valueAdded - sum;
            // 切り捨て誤差は「行数未満」であれば一致とみなす（行ごとに最大1円未満の切り捨て。
            // 切り捨ては 0 方向なので、稼ぎがマイナスの案件では誤差の符号が逆になる）
            if (Math.abs(diff) < Math.max(1, p.laborRows.length)) matched++;
            else mismatches.push(`${p.projectTitle}: V=${yen(e.valueAdded)} 行合計=${yen(sum)} 差=${yen(diff)}（${p.laborRows.length}行・総人工${e.headcount}）`);
        }
        console.log('\n--- 1) 案件ごとの検算（行の稼ぎ合計 = 案件の稼ぎ）---');
        console.log(`一致 ${matched} 件 / 不一致 ${mismatches.length} 件 / 判定対象外（稼ぎまたは人工が無い）${skipped} 件`);
        for (const m of mismatches) console.log(`  ✗ ${m}`);

        // ---- 2) 表示月の合計 ----
        const { groups, totals } = buildOwnCrewVolume({
            projects, assignments, partnerUserIds, rates, settings: vaSettings,
        });
        console.log('\n--- 2) 月合計 ---');
        console.log(`行数: ${totals.rowCount}  人工: ${totals.manDays}  時間: ${totals.hours}h  未請求の行: ${totals.unbilledRowCount}`);
        console.log(`外注換算: ${yen(totals.outsourcingEquivalent)}`);
        console.log(`稼ぎ    : ${yen(totals.earnings)}`);
        console.log(`人件費  : ${yen(totals.laborCost)}`);
        console.log(`一人当たりの稼ぎ      : ${totals.perManday != null ? yen(totals.perManday) : '—'}`);
        console.log(`人件費1円あたりの稼ぎ : ${totals.productivityRatio != null ? totals.productivityRatio.toFixed(2) : '—'}`);
        console.log(`自社でやった得        : ${yen(totals.makeVsBuy)}`);

        console.log('\n--- 班ごと ---');
        for (const g of groups) {
            console.log(
                `${g.foremanName}: ${g.totals.rowCount}行 人工${g.totals.manDays} ` +
                `外注換算${yen(g.totals.outsourcingEquivalent)} 稼ぎ${yen(g.totals.earnings)} ` +
                `人件費${yen(g.totals.laborCost)} 一人当たり${g.totals.perManday != null ? yen(g.totals.perManday) : '—'}`,
            );
        }
    } finally {
        await (await import('../lib/prisma')).prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
