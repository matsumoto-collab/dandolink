import { prisma } from '@/lib/prisma';
import { parseJsonField } from '@/lib/json-utils';
import { calcTimeDiffMinutes } from '@/utils/dateUtils';
import type { CostBreakdown } from '@/utils/costCalculation';

/**
 * 案件原価の唯一の計算ロジック（正準）。
 *
 * 利益ダッシュボード一覧 / 月次の担当者・顧客別内訳 / 案件詳細の利益タブ がすべてこれを共有し、
 * 同じ案件は必ず同じ原価になるようにする。
 *
 * - 人件費: 日報の作業時間 × 日当を、**同日(worker,date)の全案件作業時間で正確に按分**（掛け持ち日の過大計上を防ぐ）。
 *   配置ごとに `laborCostOverride` があれば採用（`override ?? auto`）。協力業者(role=partner)職長の配置は労務に計上しない。
 * - 車両費: **手配確定後のみ**計上。確定済みは confirmedVehicleIds(ID) × 車両マスタ日額、未確定は0。`vehicleCostOverride` は常に採用可。
 * - 外注費: 手配確定 × partner 職長 × 工事種別単価(作業費+運搬費) を**種別ごと初回計上**。`subcontractorCostOverride` 採用可。
 * - 材料費 / その他 / 積込: `ProjectMaster.materialCost / otherExpenses / loadingCost`。
 *
 * 手修正の入口は配置ごとの上書き（cost-override API・`ProjectProfitDisplay`）＋案件マスタの材料費等のみ（単一系統）。
 */

export interface LaborCostRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    hours: number;
    foremanName: string | null;
    workerCount: number; // 実際に原価計上した人数（日報の作業者ベース。配置のmemberCountではない）
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
export interface VehicleCostRow {
    assignmentId: string;
    date: string;
    vehicleNames: string[];
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
export interface SubcontractorCostRow {
    assignmentId: string;
    date: string;
    constructionTypeName: string | null;
    foremanName: string | null;
    autoCost: number;
    override: number | null;
    effectiveCost: number;
}
export interface PurchaseInvoiceCostRow {
    invoiceId: string;
    payeeName: string | null;
    categoryName: string | null;
    bucket: string; // 'material' | 'other' | 'loading'
    date: string;
    amount: number;
}
export interface ProjectCostDetail {
    labor: LaborCostRow[];
    vehicle: VehicleCostRow[];
    subcontractor: SubcontractorCostRow[];
    materialCost: number;
    otherExpenses: number;
    loadingCost: number;
    purchaseInvoices: PurchaseInvoiceCostRow[];
}
export interface ProjectCostResult {
    breakdown: CostBreakdown;
    detail?: ProjectCostDetail; // opts.withDetail のときのみ
}

function emptyBreakdown(): CostBreakdown {
    return { laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0 };
}

const calcMins = (s: string | null, e: string | null, brk: number) =>
    (!s || !e) ? 0 : Math.max(0, calcTimeDiffMinutes(s, e) - brk);

// 配置日の表示用キー。JST基準（UTCスライスだと夜間タイムスタンプが前日にズレるため）。
const jstDateStr = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// 日報に作業者が記録されていない配置の「働いた人」フォールバック: 手配確定メンバー＋職長（重複除去）。
// 確定メンバーが無ければ [] を返し、呼び出し側の memberCount 合成フォールバックに委ねる。
function fallbackWorkers(confirmedJson: string | null | undefined, foremanId: string | null | undefined): string[] {
    const conf = parseJsonField<string[]>(confirmedJson ?? null, []);
    if (conf.length === 0) return [];
    return foremanId && !conf.includes(foremanId) ? [...conf, foremanId] : conf;
}

/**
 * 指定案件群の原価を一括計算する。返り値は projectId → ProjectCostResult（指定 ID は必ずキーに存在）。
 */
export async function computeProjectCosts(
    projectIds: string[],
    opts: { withDetail?: boolean } = {},
): Promise<Map<string, ProjectCostResult>> {
    const result = new Map<string, ProjectCostResult>();
    if (projectIds.length === 0) return result;

    const projectMasters = await prisma.projectMaster.findMany({
        where: { id: { in: projectIds } },
        select: {
            id: true,
            materialCost: true,
            otherExpenses: true,
            loadingCost: true,
            subcontractorCosts: { select: { constructionTypeId: true, amount: true, transportCost: true } },
            purchaseInvoiceAllocations: {
                where: { purchaseInvoice: { status: 'confirmed' } },
                select: {
                    amount: true,
                    expenseCategory: { select: { name: true, costBucket: true } },
                    purchaseInvoice: { select: { id: true, payeeName: true, issueDate: true } },
                },
            },
            assignments: {
                select: {
                    id: true, date: true, assignedEmployeeId: true, isDispatchConfirmed: true,
                    constructionType: true, workers: true, memberCount: true, vehicles: true, confirmedVehicleIds: true, confirmedWorkerIds: true,
                    laborCostOverride: true, vehicleCostOverride: true, subcontractorCostOverride: true,
                    dailyReportWorkItems: {
                        select: {
                            id: true, startTime: true, endTime: true, breakMinutes: true, workerIds: true,
                            dailyReport: { select: { id: true, date: true } },
                        },
                    },
                },
            },
        },
    });

    // 日当解決用の worker/foreman ID と、按分分母を取る作業日
    const workerIdSet = new Set<string>();
    const foremanIdSet = new Set<string>();
    const dateStrSet = new Set<string>();
    for (const pm of projectMasters) {
        for (const a of pm.assignments) {
            if (a.assignedEmployeeId) { foremanIdSet.add(a.assignedEmployeeId); workerIdSet.add(a.assignedEmployeeId); }
            for (const wid of parseJsonField<string[]>(a.workers, [])) workerIdSet.add(wid);
            for (const wid of parseJsonField<string[]>(a.confirmedWorkerIds, [])) workerIdSet.add(wid);
            for (const wi of a.dailyReportWorkItems) {
                for (const wid of wi.workerIds) workerIdSet.add(wid);
                if (wi.dailyReport) dateStrSet.add(new Date(wi.dailyReport.date).toISOString().slice(0, 10));
            }
        }
    }

    const [settings, allVehicles, users, workers, foremanUsers, constructionTypes, denomItems] = await Promise.all([
        prisma.systemSettings.findFirst(),
        prisma.vehicle.findMany({ select: { id: true, name: true, dailyRate: true } }),
        workerIdSet.size > 0
            ? prisma.user.findMany({ where: { id: { in: [...workerIdSet] } }, select: { id: true, dailyRate: true } })
            : Promise.resolve([] as { id: string; dailyRate: unknown }[]),
        workerIdSet.size > 0
            ? prisma.worker.findMany({ where: { id: { in: [...workerIdSet] } }, select: { id: true, dailyRate: true } })
            : Promise.resolve([] as { id: string; dailyRate: unknown }[]),
        foremanIdSet.size > 0
            ? prisma.user.findMany({ where: { id: { in: [...foremanIdSet] } }, select: { id: true, displayName: true, role: true } })
            : Promise.resolve([] as { id: string; displayName: string; role: string }[]),
        prisma.constructionType.findMany({ select: { id: true, name: true } }),
        // 同日(worker,date)の全案件作業時間（按分の分母）。対象案件の作業日に限定して取得。
        dateStrSet.size > 0
            ? prisma.dailyReportWorkItem.findMany({
                where: { dailyReport: { date: { in: [...dateStrSet].map(d => new Date(`${d}T00:00:00.000Z`)) } } },
                select: {
                    startTime: true, endTime: true, breakMinutes: true, workerIds: true,
                    assignment: { select: { workers: true, confirmedWorkerIds: true, assignedEmployeeId: true } },
                    dailyReport: { select: { date: true } },
                },
            })
            : Promise.resolve([] as Array<{ startTime: string | null; endTime: string | null; breakMinutes: number | null; workerIds: string[]; assignment: { workers: string | null; confirmedWorkerIds: string | null; assignedEmployeeId: string | null }; dailyReport: { date: Date } | null }>),
    ]);

    const defaultDailyRate = Number(settings?.laborDailyRate ?? 18000);
    const dailyRateMap = new Map<string, number>();
    for (const u of users) dailyRateMap.set(u.id, u.dailyRate ? Number(u.dailyRate) : defaultDailyRate);
    for (const w of workers) if (!dailyRateMap.has(w.id)) dailyRateMap.set(w.id, w.dailyRate ? Number(w.dailyRate) : defaultDailyRate);
    // 車両費は手配確定後のみ計上＝confirmedVehicleIds(ID)で日額を引き当てる
    const vehicleRateById = new Map(allVehicles.map(v => [v.id, Number(v.dailyRate || 0)]));
    const vehicleNameById = new Map(allVehicles.map(v => [v.id, v.name]));
    const foremanNameMap = new Map(foremanUsers.map(u => [u.id, u.displayName]));
    const ctNameMap = new Map(constructionTypes.map(c => [c.id, c.name]));
    // 役割はDBに大文字(PARTNER等)で入る個体があるため小文字化して判定する（他箇所と同様）。
    const partnerForemanIds = new Set(foremanUsers.filter(u => (u.role ?? '').toLowerCase() === 'partner').map(u => u.id));

    // 分母: (worker|date) → その日の総作業分（全案件）
    const workerDayTotalMinutes = new Map<string, number>();
    for (const it of denomItems) {
        if (!it.dailyReport) continue;
        const mins = calcMins(it.startTime, it.endTime, it.breakMinutes || 0);
        if (mins <= 0) continue;
        const d = new Date(it.dailyReport.date).toISOString().slice(0, 10);
        const itWorkers = parseJsonField<string[]>(it.assignment.workers, []);
        const ids = it.workerIds.length > 0
            ? it.workerIds
            : (itWorkers.length > 0 ? itWorkers : fallbackWorkers(it.assignment.confirmedWorkerIds, it.assignment.assignedEmployeeId));
        for (const wid of ids) {
            const key = `${wid}|${d}`;
            workerDayTotalMinutes.set(key, (workerDayTotalMinutes.get(key) || 0) + mins);
        }
    }

    for (const pm of projectMasters) {
        let laborCost = 0, vehicleCost = 0, subcontractorCost = 0;
        const subcontractorTypeUsed = new Set<string>(); // 案件ごとに種別初回のみ自動計上
        const subcontractorTypeAmount = new Map<string, number>(
            pm.subcontractorCosts.map(c => [c.constructionTypeId, Number(c.amount || 0) + Number(c.transportCost || 0)]),
        );
        const laborRows: LaborCostRow[] = [];
        const vehicleRows: VehicleCostRow[] = [];
        const subRows: SubcontractorCostRow[] = [];

        for (const a of pm.assignments) {
            const dateStr = jstDateStr(a.date);
            const ctName = a.constructionType ? (ctNameMap.get(a.constructionType) ?? null) : null;
            const foremanName = foremanNameMap.get(a.assignedEmployeeId) ?? null;
            const isPartnerForeman = partnerForemanIds.has(a.assignedEmployeeId);

            // 配置の移動(リスケ)で別日に取り残された「作業者0名の空明細」を原価から除外（二重計上防止）。
            // 配置日と同じ日(JST)の明細、または作業者のいる明細だけを採用する（別日の実作業は誤って落とさない）。
            const aWorkers = parseJsonField<string[]>(a.workers, []);
            const workItems = a.dailyReportWorkItems.filter(wi => {
                if (!wi.dailyReport) return true;
                if (jstDateStr(wi.dailyReport.date) === dateStr) return true; // 配置日と同日はそのまま
                return !(wi.workerIds.length === 0 && aWorkers.length === 0); // 別日かつ空＝移動残骸は除外
            });

            // ---- 労務費（配置単位・正確按分・上書き） ----
            let raw = 0, assignmentMinutes = 0;
            const workerIdsCosted = new Set<string>(); // 実際に計上した作業者（人数表示用）
            for (const wi of workItems) {
                if (!wi.dailyReport) continue;
                const mins = calcMins(wi.startTime, wi.endTime, wi.breakMinutes || 0);
                if (mins <= 0) continue;
                assignmentMinutes += mins;
                const wDate = new Date(wi.dailyReport.date).toISOString().slice(0, 10);
                // 作業者: 日報明細 → 配置のworkers → 手配確定メンバー(＋職長) → 最後にmemberCount合成
                let ids = wi.workerIds.length > 0
                    ? wi.workerIds
                    : (aWorkers.length > 0 ? aWorkers : fallbackWorkers(a.confirmedWorkerIds, a.assignedEmployeeId));
                if (ids.length === 0) {
                    const count = a.memberCount || 1;
                    ids = Array.from({ length: count }, (_, i) => `__fb__:${wi.id}:${i}`);
                    for (const wid of ids) workerDayTotalMinutes.set(`${wid}|${wDate}`, mins);
                }
                for (const wid of ids) {
                    workerIdsCosted.add(wid);
                    const total = workerDayTotalMinutes.get(`${wid}|${wDate}`) || mins;
                    const rate = dailyRateMap.get(wid) ?? defaultDailyRate;
                    raw += rate * (mins / total);
                }
            }
            const autoLabor = Math.round(raw / 100) * 100;
            const effLabor = a.laborCostOverride != null ? a.laborCostOverride : autoLabor;
            if (!isPartnerForeman) {
                laborCost += effLabor;
                if (opts.withDetail) {
                    laborRows.push({
                        assignmentId: a.id, date: dateStr, constructionTypeName: ctName,
                        hours: Math.round((assignmentMinutes / 60) * 10) / 10,
                        foremanName, workerCount: workerIdsCosted.size,
                        autoCost: autoLabor, override: a.laborCostOverride, effectiveCost: effLabor,
                    });
                }
            }

            // ---- 車両費（手配確定後のみ計上。確定済み=confirmedVehicleIds(ID)で計上、未確定は0。手動上書きは常に有効） ----
            // 予定段階の車両(当日その車両で行けるかは前日頃に決まる)は原価に載せない（kei方針2026-06-09）。
            const confirmedVehIds = parseJsonField<string[]>(a.confirmedVehicleIds, []);
            const vehNames = a.isDispatchConfirmed
                ? confirmedVehIds.map(vid => vehicleNameById.get(vid) ?? '不明')
                : [];
            const autoVeh = a.isDispatchConfirmed
                ? confirmedVehIds.reduce((s, vid) => s + (vehicleRateById.get(vid) || 0), 0)
                : 0;
            const effVeh = a.vehicleCostOverride != null ? a.vehicleCostOverride : autoVeh;
            vehicleCost += effVeh;
            if (opts.withDetail && (vehNames.length > 0 || a.vehicleCostOverride != null)) {
                vehicleRows.push({
                    assignmentId: a.id, date: dateStr,
                    vehicleNames: vehNames.filter(Boolean),
                    autoCost: autoVeh, override: a.vehicleCostOverride, effectiveCost: effVeh,
                });
            }

            // ---- 外注費（協力業者） ----
            const isPartnerSub = a.isDispatchConfirmed
                && partnerForemanIds.has(a.assignedEmployeeId)
                && !!a.constructionType
                && subcontractorTypeAmount.has(a.constructionType);
            const autoSub = isPartnerSub && a.constructionType && !subcontractorTypeUsed.has(a.constructionType)
                ? (subcontractorTypeAmount.get(a.constructionType) ?? 0)
                : 0;
            if (autoSub > 0 && a.constructionType) subcontractorTypeUsed.add(a.constructionType);
            const hasSubOv = a.subcontractorCostOverride != null;
            const effSub = hasSubOv ? (a.subcontractorCostOverride as number) : autoSub;
            subcontractorCost += effSub;
            if (opts.withDetail && (isPartnerSub || hasSubOv)) {
                subRows.push({
                    assignmentId: a.id, date: dateStr, constructionTypeName: ctName, foremanName,
                    autoCost: autoSub, override: a.subcontractorCostOverride, effectiveCost: effSub,
                });
            }
        }

        // 確定済み仕入請求書の案件配分を費目の集計先(costBucket)ごとに原価へ上乗せ（配分なし＝請求書原価0）
        const invoiceRows: PurchaseInvoiceCostRow[] = [];
        let invMaterial = 0, invOther = 0, invLoading = 0;
        for (const al of pm.purchaseInvoiceAllocations ?? []) {
            const amount = Number(al.amount || 0);
            if (amount <= 0) continue;
            const bucket = al.expenseCategory?.costBucket ?? 'other';
            if (bucket === 'material') invMaterial += amount;
            else if (bucket === 'loading') invLoading += amount;
            else invOther += amount;
            if (opts.withDetail) {
                invoiceRows.push({
                    invoiceId: al.purchaseInvoice.id,
                    payeeName: al.purchaseInvoice.payeeName,
                    categoryName: al.expenseCategory?.name ?? null,
                    bucket,
                    date: al.purchaseInvoice.issueDate ? jstDateStr(al.purchaseInvoice.issueDate) : '',
                    amount,
                });
            }
        }
        // 手入力分（案件マスタの数値）と請求書由来分を分けて保持。
        // breakdown(原価合計)は両方の和、detail は手入力分のみを返し、請求書分は purchaseInvoices 明細で見せる。
        const manualMaterial = Number(pm.materialCost || 0);
        const manualOther = Number(pm.otherExpenses || 0);
        const manualLoading = Number(pm.loadingCost || 0);
        const materialCost = manualMaterial + invMaterial;
        const otherExpenses = manualOther + invOther;
        const loadingCost = manualLoading + invLoading;
        const totalCost = laborCost + loadingCost + vehicleCost + materialCost + subcontractorCost + otherExpenses;

        result.set(pm.id, {
            breakdown: { laborCost, loadingCost, vehicleCost, materialCost, subcontractorCost, otherExpenses, totalCost },
            detail: opts.withDetail
                ? {
                    labor: laborRows.sort((x, y) => x.date.localeCompare(y.date)),
                    vehicle: vehicleRows.sort((x, y) => x.date.localeCompare(y.date)),
                    subcontractor: subRows.sort((x, y) => x.date.localeCompare(y.date)),
                    materialCost: manualMaterial, otherExpenses: manualOther, loadingCost: manualLoading,
                    purchaseInvoices: invoiceRows,
                }
                : undefined,
        });
    }

    // 取得できなかった案件IDも空原価でキーを埋める（呼び出し側 get の undefined 回避）
    for (const pid of projectIds) if (!result.has(pid)) result.set(pid, { breakdown: emptyBreakdown() });

    return result;
}
