/**
 * 過去データ取込の実行部（DB に触る）。
 *
 *   preparePlan()  … ドライラン。件数・金額・期別・エラー行・消える行を出す（書き込まない）
 *   applyPlan()    … 本実行。externalKey で upsert し、CSV から消えた過去データを消す（同期）
 *   previewRollback() / rollbackBatch() … 取り込みバッチ単位の取り消し
 *
 * --- 守ること（仕様書 v1.0 ＋ kei 決定）---
 *   ・進行中のデータ（isBackfilled=false）には一切書き込まない。
 *     upsert の上書きは `WHERE isBackfilled = true` 付き、削除も isBackfilled=true の行だけ。
 *   ・過去データの案件に進行中のデータ（新しい配置・請求書・見積など）が紐づいていたら、その案件は消さない。
 *     案件を消すと配置などが連鎖削除される（onDelete: Cascade）ため。
 *   ・同じ externalKey は上書き。名寄せを直した CSV を何度でも取り込み直せる。
 *     CSV から消えた過去データは消す（残すと案件ID が変わった分の売上が二重になる）。
 *
 * 1 万行を超えるので 1 行ずつの upsert では Vercel の時間内に終わらない。
 * 500 行ずつまとめた `INSERT ... ON CONFLICT` を 1 つのトランザクションで流す。
 */
import { createHash, randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
    BACKFILL_INVOICE_NUMBER_PREFIX,
    BACKFILL_UNMATCHED_FOREMAN_ID,
    fiscalTermOf,
    fiscalTermRange,
    jstDateToInstant,
} from './constants';
import { buildCustomerMatcher, buildForemanMatcher, normalizeCompanyName } from './matching';
import { parseBackfillFiles, type BackfillFileTexts, type BackfillIssue, type ParsedBackfill } from './parse';

type Client = PrismaClient | Prisma.TransactionClient;

const CHUNK = 500;

// ============================================================================
// ドライランの結果（画面にそのまま出す）
// ============================================================================

export interface BackfillCountSummary {
    /** CSV の行数 */
    total: number;
    /** 新しく作る */
    create: number;
    /** 既にあるので上書きする */
    update: number;
    /** CSV から消えたので消す */
    delete: number;
}

export interface BackfillTermSummary {
    term: number;
    label: string;
    from: string;
    to: string;
    /** 現場別売上 ＋ 売上調整（税抜） */
    sales: number;
    /** 自社の延べ人工 */
    manDays: number;
    /** 売上 ÷ 人工（円・四捨五入） */
    salesPerManDay: number | null;
}

export interface BackfillPlanSummary {
    /** 4 ファイルの中身のハッシュ。本実行はドライランと同じファイルでしか通さない */
    hash: string;
    counts: {
        projects: BackfillCountSummary;
        sales: BackfillCountSummary;
        works: BackfillCountSummary;
        adjustments: BackfillCountSummary;
    };
    totals: {
        salesAmount: number;
        adjustmentAmount: number;
        grandTotal: number;
        ownManDays: number;
        nonSiteProjects: number;
        subcontractRows: number;
        filledRows: number;
    };
    terms: BackfillTermSummary[];
    mapping: {
        foremenMatched: number;
        foremenUnmatched: { name: string; rows: number }[];
        customersMatched: number;
        customersUnmatched: { name: string; projects: number }[];
    };
    /** 過去データの案件なのに進行中のデータが紐づいているため消さない案件 */
    blockedDeletes: { externalKey: string; title: string; reason: string }[];
    errors: BackfillIssue[];
    warnings: BackfillIssue[];
    canApply: boolean;
}

// ============================================================================
// 書き込む行（applyPlan に渡す）
// ============================================================================

interface ProjectWrite {
    id: string;
    externalKey: string;
    title: string;
    customerId: string | null;
    customerName: string;
    description: string;
    dataSource: string;
    isNonSite: boolean;
    createdAt: Date;
    /** 最終日。一覧は更新日の新しい順なので、取込した時刻にすると過去案件が先頭に固まる */
    updatedAt: Date;
}

interface InvoiceWrite {
    id: string;
    externalKey: string;
    invoiceNumber: string;
    projectMasterId: string;
    customerId: string | null;
    title: string;
    items: string;
    subtotal: number;
    tax: number;
    total: number;
    billedAt: Date;
}

interface AssignmentWrite {
    id: string;
    externalKey: string;
    projectMasterId: string;
    assignedEmployeeId: string;
    date: Date;
    memberCount: number;
    backfillInfo: string;
}

interface AdjustmentWrite {
    id: string;
    externalKey: string;
    customerName: string;
    yearMonth: string;
    amountExclTax: number;
    ledgerAmountExclTax: number | null;
    invoiceAmountExclTax: number | null;
}

export interface PreparedBackfill {
    summary: BackfillPlanSummary;
    projects: ProjectWrite[];
    invoices: InvoiceWrite[];
    assignments: AssignmentWrite[];
    adjustments: AdjustmentWrite[];
    /** 同期で消す過去データの ID */
    deleteIds: { projects: string[]; invoices: string[]; assignments: string[]; adjustments: string[] };
}

export function hashBackfillFiles(texts: BackfillFileTexts): string {
    const h = createHash('sha256');
    for (const k of ['projects', 'sales', 'works', 'adjustments'] as const) {
        h.update(k);
        h.update('\0');
        h.update(texts[k]);
        h.update('\0');
    }
    return h.digest('hex');
}

/** 進行中のデータが紐づいている過去案件（消すと巻き添えで消えるもの）を探す */
async function findProjectsWithLiveData(client: Client, projectIds: string[]): Promise<Map<string, string>> {
    const reasons = new Map<string, string>();
    if (projectIds.length === 0) return reasons;
    const note = (id: string | null, reason: string) => {
        if (id && !reasons.has(id)) reasons.set(id, reason);
    };
    const [assignments, invoices, estimates, files, requisitions, receipts, drafts] = await Promise.all([
        client.projectAssignment.findMany({ where: { projectMasterId: { in: projectIds }, isBackfilled: false }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        client.invoice.findMany({ where: { projectMasterId: { in: projectIds }, isBackfilled: false }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        client.estimate.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        client.projectMasterFile.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        client.materialRequisition.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        client.receipt.findMany({ where: { projectMasterId: { in: projectIds } }, select: { projectMasterId: true }, distinct: ['projectMasterId'] }),
        // 請求予定は projectId で持つ（onDelete: Restrict なので残っていると案件を消せない）
        client.billingDraft.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true }, distinct: ['projectId'] }),
    ]);
    for (const r of assignments) note(r.projectMasterId, '新しい配置が紐づいている');
    for (const r of invoices) note(r.projectMasterId, '新しい請求書が紐づいている');
    for (const r of estimates) note(r.projectMasterId, '見積書が紐づいている');
    for (const r of files) note(r.projectMasterId, 'ファイルが添付されている');
    for (const r of requisitions) note(r.projectMasterId, '材料伝票が紐づいている');
    for (const r of receipts) note(r.projectMasterId, '領収書が紐づいている');
    for (const r of drafts) note(r.projectId, '請求予定が紐づいている');
    return reasons;
}

/**
 * ドライラン。CSV を検査し、既存の過去データと突き合わせて「何件作る・上書きする・消すか」を出す。
 * DB には書き込まない。エラーがあっても集計は出す（どの行を直せばいいかを見せるため）。
 */
export async function preparePlan(client: Client, texts: BackfillFileTexts): Promise<PreparedBackfill> {
    const parsed: ParsedBackfill = parseBackfillFiles(texts);
    const hash = hashBackfillFiles(texts);

    // ---- 既存の過去データ（externalKey → id） ----
    const [pmExisting, invExisting, asgExisting, adjExisting, users, customers] = await Promise.all([
        client.projectMaster.findMany({ where: { isBackfilled: true }, select: { id: true, externalKey: true, title: true } }),
        client.invoice.findMany({ where: { isBackfilled: true }, select: { id: true, externalKey: true } }),
        client.projectAssignment.findMany({ where: { isBackfilled: true }, select: { id: true, externalKey: true } }),
        client.revenueAdjustment.findMany({ select: { id: true, externalKey: true } }),
        client.user.findMany({ select: { id: true, displayName: true, isActive: true } }),
        client.customer.findMany({ select: { id: true, name: true, shortName: true } }),
    ]);
    const idOf = <T extends { id: string; externalKey: string | null }>(rows: T[]) =>
        new Map(rows.filter((r) => r.externalKey).map((r) => [r.externalKey as string, r.id]));
    const pmIdByKey = idOf(pmExisting);
    const invIdByKey = idOf(invExisting);
    const asgIdByKey = idOf(asgExisting);
    const adjIdByKey = idOf(adjExisting);

    const matchForeman = buildForemanMatcher(users);
    const matchCustomer = buildCustomerMatcher(customers);

    // ---- 案件 ----
    const projectIdByKey = new Map<string, string>();
    const customersUnmatched = new Map<string, number>();
    let customersMatched = 0;
    const projects: ProjectWrite[] = parsed.projects.map((p) => {
        const id = pmIdByKey.get(p.externalKey) ?? randomUUID();
        projectIdByKey.set(p.externalKey, id);
        const cust = p.customer ? matchCustomer(p.customer) : null;
        if (cust) customersMatched++;
        else if (p.customer) customersUnmatched.set(p.customer, (customersUnmatched.get(p.customer) ?? 0) + 1);
        return {
            id,
            externalKey: p.externalKey,
            title: p.siteName,
            customerId: cust?.id ?? null,
            // 顧客マスタと一致すれば正式名、しなければ CSV の名前（法人格を除いた正規化後の名前）
            customerName: cust?.name ?? p.customer,
            description: `過去データ（${p.dataSource}）${p.firstDate}〜${p.lastDate}`,
            dataSource: p.dataSource,
            isNonSite: p.isNonSite,
            createdAt: jstDateToInstant(p.firstDate),
            updatedAt: jstDateToInstant(p.lastDate),
        };
    });

    // ---- 売上（請求書） ----
    const invoices: InvoiceWrite[] = parsed.sales.map((s) => {
        const projectMasterId = projectIdByKey.get(s.projectKey)!;
        const cust = s.customer ? matchCustomer(s.customer) : null;
        const tax = Math.round(s.amountExclTax * 0.1);
        return {
            id: invIdByKey.get(s.externalKey) ?? randomUUID(),
            externalKey: s.externalKey,
            invoiceNumber: `${BACKFILL_INVOICE_NUMBER_PREFIX}${s.externalKey}`,
            projectMasterId,
            customerId: cust?.id ?? null,
            title: s.originalSiteName || s.projectKey,
            // 明細は 1 行。案件IDを付けておくと、按分（invoiceProjectShares）がこの案件に全額を帰属させる
            items: JSON.stringify([
                {
                    id: `bf-${s.externalKey}`,
                    description: s.originalSiteName,
                    specification: '',
                    quantity: 1,
                    unit: '式',
                    unitPrice: s.amountExclTax,
                    amount: s.amountExclTax,
                    taxType: 'standard',
                    notes: '過去データ（請求書PDFから取込）',
                    projectMasterId,
                },
            ]),
            subtotal: s.amountExclTax,
            tax,
            total: s.amountExclTax + tax,
            billedAt: jstDateToInstant(s.billedOn),
        };
    });

    // ---- 作業履歴（配置） ----
    const foremenUnmatched = new Map<string, number>();
    const foremenMatchedNames = new Set<string>();
    const assignments: AssignmentWrite[] = parsed.works.map((w) => {
        const userId = w.foreman ? matchForeman(w.foreman) : null;
        if (userId) foremenMatchedNames.add(w.foreman);
        else foremenUnmatched.set(w.foreman || '（空欄）', (foremenUnmatched.get(w.foreman || '（空欄）') ?? 0) + 1);
        return {
            id: asgIdByKey.get(w.externalKey) ?? randomUUID(),
            externalKey: w.externalKey,
            projectMasterId: projectIdByKey.get(w.projectKey)!,
            assignedEmployeeId: userId ?? BACKFILL_UNMATCHED_FOREMAN_ID,
            date: jstDateToInstant(w.workedOn),
            // 外注の行は人数 0（外注費として原価側で扱うため・仕様 3-2）。元の人数は backfillInfo に残す
            memberCount: w.category === '自社' ? w.originalHeadcount : 0,
            backfillInfo: JSON.stringify({
                foremanName: w.foreman,
                category: w.category,
                headcountFilled: w.headcountFilled,
                originalHeadcount: w.originalHeadcount,
                originalSiteName: w.originalSiteName,
                primeContractor: w.primeContractor,
            }),
        };
    });

    // ---- 売上調整 ----
    const adjustments: AdjustmentWrite[] = parsed.adjustments.map((a) => ({
        id: adjIdByKey.get(a.externalKey) ?? randomUUID(),
        externalKey: a.externalKey,
        customerName: a.customer,
        yearMonth: a.yearMonth,
        amountExclTax: a.amountExclTax,
        ledgerAmountExclTax: a.ledgerAmountExclTax,
        invoiceAmountExclTax: a.invoiceAmountExclTax,
    }));

    // ---- 同期で消すもの（既存の過去データのうち CSV に無いもの） ----
    const keepKeys = <T extends { externalKey: string }>(rows: T[]) => new Set(rows.map((r) => r.externalKey));
    const pk = keepKeys(projects), ik = keepKeys(invoices), ak = keepKeys(assignments), jk = keepKeys(adjustments);
    const staleProjects = pmExisting.filter((r) => r.externalKey && !pk.has(r.externalKey));
    const blockedReasons = await findProjectsWithLiveData(client, staleProjects.map((r) => r.id));
    const blockedDeletes = staleProjects
        .filter((r) => blockedReasons.has(r.id))
        .map((r) => ({ externalKey: r.externalKey as string, title: r.title, reason: blockedReasons.get(r.id)! }));
    const deleteIds = {
        projects: staleProjects.filter((r) => !blockedReasons.has(r.id)).map((r) => r.id),
        invoices: invExisting.filter((r) => r.externalKey && !ik.has(r.externalKey)).map((r) => r.id),
        assignments: asgExisting.filter((r) => r.externalKey && !ak.has(r.externalKey)).map((r) => r.id),
        adjustments: adjExisting.filter((r) => r.externalKey && !jk.has(r.externalKey)).map((r) => r.id),
    };

    const countOf = (rows: { externalKey: string }[], existing: Map<string, string>, deletes: number): BackfillCountSummary => {
        const update = rows.filter((r) => existing.has(r.externalKey)).length;
        return { total: rows.length, create: rows.length - update, update, delete: deletes };
    };

    // ---- 期別（仕様 4-2 の突き合わせ用） ----
    const salesByMonth = new Map<string, number>();
    for (const s of parsed.sales) salesByMonth.set(s.billedOn.slice(0, 7), (salesByMonth.get(s.billedOn.slice(0, 7)) ?? 0) + s.amountExclTax);
    for (const a of parsed.adjustments) salesByMonth.set(a.yearMonth, (salesByMonth.get(a.yearMonth) ?? 0) + a.amountExclTax);
    const manDaysByMonth = new Map<string, number>();
    for (const w of parsed.works) {
        if (w.category !== '自社') continue;
        const ym = w.workedOn.slice(0, 7);
        manDaysByMonth.set(ym, (manDaysByMonth.get(ym) ?? 0) + w.originalHeadcount);
    }
    const termSet = new Set<number>();
    for (const ym of [...salesByMonth.keys(), ...manDaysByMonth.keys()]) termSet.add(fiscalTermOf(ym));
    const terms: BackfillTermSummary[] = [...termSet].sort((a, b) => a - b).map((term) => {
        const { from, to } = fiscalTermRange(term);
        let sales = 0, manDays = 0;
        for (const [ym, v] of salesByMonth) if (ym >= from && ym <= to) sales += v;
        for (const [ym, v] of manDaysByMonth) if (ym >= from && ym <= to) manDays += v;
        return { term, label: `第${term}期`, from, to, sales, manDays, salesPerManDay: manDays > 0 ? Math.round(sales / manDays) : null };
    });

    const salesAmount = parsed.sales.reduce((s, x) => s + x.amountExclTax, 0);
    const adjustmentAmount = parsed.adjustments.reduce((s, x) => s + x.amountExclTax, 0);

    const summary: BackfillPlanSummary = {
        hash,
        counts: {
            projects: countOf(projects, pmIdByKey, deleteIds.projects.length),
            sales: countOf(invoices, invIdByKey, deleteIds.invoices.length),
            works: countOf(assignments, asgIdByKey, deleteIds.assignments.length),
            adjustments: countOf(adjustments, adjIdByKey, deleteIds.adjustments.length),
        },
        totals: {
            salesAmount,
            adjustmentAmount,
            grandTotal: salesAmount + adjustmentAmount,
            ownManDays: [...manDaysByMonth.values()].reduce((s, v) => s + v, 0),
            nonSiteProjects: parsed.projects.filter((p) => p.isNonSite).length,
            subcontractRows: parsed.works.filter((w) => w.category === '外注').length,
            filledRows: parsed.works.filter((w) => w.headcountFilled).length,
        },
        terms,
        mapping: {
            foremenMatched: foremenMatchedNames.size,
            foremenUnmatched: [...foremenUnmatched].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows),
            customersMatched,
            customersUnmatched: [...customersUnmatched].map(([name, n]) => ({ name, projects: n })).sort((a, b) => b.projects - a.projects),
        },
        blockedDeletes,
        errors: parsed.errors,
        warnings: parsed.warnings,
        canApply: parsed.errors.length === 0,
    };

    return { summary, projects, invoices, assignments, adjustments, deleteIds };
}

// ============================================================================
// 本実行
// ============================================================================

/** 行の配列を CHUNK 行ずつに分ける */
function chunks<T>(rows: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
    return out;
}

export interface BackfillApplyResult {
    batchId: string;
    written: { projects: number; invoices: number; assignments: number; adjustments: number };
    deleted: { projects: number; invoices: number; assignments: number; adjustments: number };
    /** 書き込んだ直後（コミット前）に数え直した過去データの合計 */
    totalsAfter: { projects: number; salesAmount: number; adjustmentAmount: number; ownManDays: number };
    /** true = リハーサル（最後に取り消したので DB には何も残っていない） */
    rehearsed: boolean;
}

/** リハーサルでトランザクションを取り消すための目印 */
class RehearsalRollback extends Error {
    constructor(readonly result: Omit<BackfillApplyResult, 'batchId' | 'written' | 'rehearsed'>) {
        super('rehearsal rollback');
    }
}

/**
 * 本実行。ドライランの結果（preparePlan の戻り値）をそのまま書き込む。
 * 全部を 1 つのトランザクションで行うので、途中で失敗したら何も変わらない。
 */
export async function applyPlan(
    prisma: PrismaClient,
    prepared: PreparedBackfill,
    meta: { userId: string | null; userName: string; fileNames: Record<string, string> },
    options: { rehearse?: boolean } = {},
): Promise<BackfillApplyResult> {
    if (!prepared.summary.canApply) throw new Error('エラーのある行があるため取り込めません');
    const batchId = randomUUID();
    const now = new Date();

    let outcome: { deleted: BackfillApplyResult['deleted']; totalsAfter: BackfillApplyResult['totalsAfter'] };
    try {
    outcome = await prisma.$transaction(
        async (tx) => {
            // 同時に 2 人が取り込むと同期削除がぶつかるので、取込どうしを 1 本に並べる
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dandolink-backfill-import'))`;

            await tx.backfillImportBatch.create({
                data: {
                    id: batchId,
                    status: 'applied',
                    createdBy: meta.userId,
                    createdByName: meta.userName,
                    fileNames: meta.fileNames,
                },
            });

            // ---- 1. 案件 ----
            for (const part of chunks(prepared.projects)) {
                const values = part.map((p) => Prisma.sql`(
                    ${p.id}, ${p.title}, ${p.title}, 'other', 'completed', ${p.description},
                    ${p.customerId}, ${p.customerName}, ${p.createdAt}, ${p.updatedAt},
                    true, ${p.dataSource}, ${p.isNonSite}, ${batchId}, ${p.externalKey}
                )`);
                await tx.$executeRaw`
                    INSERT INTO "public"."ProjectMaster" (
                        "id", "title", "name", "constructionType", "status", "description",
                        "customerId", "customerName", "createdAt", "updatedAt",
                        "isBackfilled", "dataSource", "isNonSite", "importBatchId", "externalKey"
                    ) VALUES ${Prisma.join(values)}
                    ON CONFLICT ("externalKey") DO UPDATE SET
                        "title" = EXCLUDED."title",
                        "name" = EXCLUDED."name",
                        "status" = EXCLUDED."status",
                        "description" = EXCLUDED."description",
                        "customerId" = EXCLUDED."customerId",
                        "customerName" = EXCLUDED."customerName",
                        "createdAt" = EXCLUDED."createdAt",
                        "updatedAt" = EXCLUDED."updatedAt",
                        "dataSource" = EXCLUDED."dataSource",
                        "isNonSite" = EXCLUDED."isNonSite",
                        "importBatchId" = EXCLUDED."importBatchId"
                    WHERE "ProjectMaster"."isBackfilled" = true
                `;
            }

            // ---- 2. 売上（請求書） ----
            for (const part of chunks(prepared.invoices)) {
                const values = part.map((i) => Prisma.sql`(
                    ${i.id}, ${i.invoiceNumber}, ${i.title}, ${i.items},
                    ${i.subtotal}, ${i.tax}, ${i.total}, ${i.billedAt}, 'paid',
                    '過去データ（請求書PDFから取込）', ${i.billedAt}, ${now},
                    ${i.projectMasterId}, ${i.customerId},
                    true, ${batchId}, ${i.externalKey}
                )`);
                await tx.$executeRaw`
                    INSERT INTO "public"."Invoice" (
                        "id", "invoiceNumber", "title", "items",
                        "subtotal", "tax", "total", "dueDate", "status",
                        "notes", "createdAt", "updatedAt",
                        "projectMasterId", "customerId",
                        "isBackfilled", "importBatchId", "externalKey"
                    ) VALUES ${Prisma.join(values)}
                    ON CONFLICT ("externalKey") DO UPDATE SET
                        "invoiceNumber" = EXCLUDED."invoiceNumber",
                        "title" = EXCLUDED."title",
                        "items" = EXCLUDED."items",
                        "subtotal" = EXCLUDED."subtotal",
                        "tax" = EXCLUDED."tax",
                        "total" = EXCLUDED."total",
                        "dueDate" = EXCLUDED."dueDate",
                        "status" = EXCLUDED."status",
                        "notes" = EXCLUDED."notes",
                        "createdAt" = EXCLUDED."createdAt",
                        "updatedAt" = EXCLUDED."updatedAt",
                        "projectMasterId" = EXCLUDED."projectMasterId",
                        "customerId" = EXCLUDED."customerId",
                        "importBatchId" = EXCLUDED."importBatchId"
                    WHERE "Invoice"."isBackfilled" = true
                `;
            }

            // ---- 3. 作業履歴（配置） ----
            for (const part of chunks(prepared.assignments)) {
                const values = part.map((a) => Prisma.sql`(
                    ${a.id}, ${a.projectMasterId}, ${a.assignedEmployeeId}, ${a.date}, ${a.memberCount},
                    ${now}, true, ${batchId}, ${a.externalKey}, ${a.backfillInfo}::jsonb
                )`);
                await tx.$executeRaw`
                    INSERT INTO "public"."ProjectAssignment" (
                        "id", "projectMasterId", "assignedEmployeeId", "date", "memberCount",
                        "updatedAt", "isBackfilled", "importBatchId", "externalKey", "backfillInfo"
                    ) VALUES ${Prisma.join(values)}
                    ON CONFLICT ("externalKey") DO UPDATE SET
                        "projectMasterId" = EXCLUDED."projectMasterId",
                        "assignedEmployeeId" = EXCLUDED."assignedEmployeeId",
                        "date" = EXCLUDED."date",
                        "memberCount" = EXCLUDED."memberCount",
                        "updatedAt" = EXCLUDED."updatedAt",
                        "importBatchId" = EXCLUDED."importBatchId",
                        "backfillInfo" = EXCLUDED."backfillInfo"
                    WHERE "ProjectAssignment"."isBackfilled" = true
                `;
            }

            // ---- 4. 売上調整 ----
            for (const part of chunks(prepared.adjustments)) {
                const values = part.map((a) => Prisma.sql`(
                    ${a.id}, ${a.customerName}, ${a.yearMonth}, ${a.amountExclTax},
                    ${a.ledgerAmountExclTax}, ${a.invoiceAmountExclTax}, ${batchId}, ${a.externalKey}, ${now}
                )`);
                await tx.$executeRaw`
                    INSERT INTO "public"."RevenueAdjustment" (
                        "id", "customerName", "yearMonth", "amountExclTax",
                        "ledgerAmountExclTax", "invoiceAmountExclTax", "importBatchId", "externalKey", "updatedAt"
                    ) VALUES ${Prisma.join(values)}
                    ON CONFLICT ("externalKey") DO UPDATE SET
                        "customerName" = EXCLUDED."customerName",
                        "yearMonth" = EXCLUDED."yearMonth",
                        "amountExclTax" = EXCLUDED."amountExclTax",
                        "ledgerAmountExclTax" = EXCLUDED."ledgerAmountExclTax",
                        "invoiceAmountExclTax" = EXCLUDED."invoiceAmountExclTax",
                        "importBatchId" = EXCLUDED."importBatchId",
                        "updatedAt" = EXCLUDED."updatedAt"
                `;
            }

            // ---- 5. 同期: CSV から消えた過去データを消す（isBackfilled=true の行だけ） ----
            const d = prepared.deleteIds;
            const [asg, inv, adj] = await Promise.all([
                d.assignments.length
                    ? tx.projectAssignment.deleteMany({ where: { id: { in: d.assignments }, isBackfilled: true } })
                    : { count: 0 },
                d.invoices.length
                    ? tx.invoice.deleteMany({ where: { id: { in: d.invoices }, isBackfilled: true } })
                    : { count: 0 },
                d.adjustments.length
                    ? tx.revenueAdjustment.deleteMany({ where: { id: { in: d.adjustments } } })
                    : { count: 0 },
            ]);
            // 案件は最後。消す直前にもう一度「進行中のデータが紐づいていないか」を確かめる
            const stillBlocked = await findProjectsWithLiveData(tx, d.projects);
            const projectIds = d.projects.filter((id) => !stillBlocked.has(id));
            const pm = projectIds.length
                ? await tx.projectMaster.deleteMany({ where: { id: { in: projectIds }, isBackfilled: true } })
                : { count: 0 };

            const result = { projects: pm.count, invoices: inv.count, assignments: asg.count, adjustments: adj.count };

            // 書いた直後に数え直す（コミット前なので、リハーサルでもこの数字は本実行と同じになる）
            const [pmCount, invSum, adjSum, mdSum] = await Promise.all([
                tx.projectMaster.count({ where: { isBackfilled: true } }),
                tx.invoice.aggregate({ where: { isBackfilled: true }, _sum: { subtotal: true } }),
                tx.revenueAdjustment.aggregate({ _sum: { amountExclTax: true } }),
                tx.projectAssignment.aggregate({ where: { isBackfilled: true }, _sum: { memberCount: true } }),
            ]);
            const totalsAfter = {
                projects: pmCount,
                salesAmount: Number(invSum._sum.subtotal ?? 0),
                adjustmentAmount: adjSum._sum.amountExclTax ?? 0,
                ownManDays: mdSum._sum.memberCount ?? 0,
            };
            // リハーサルはここで取り消す（例外で抜けると Prisma がロールバックする）
            if (options.rehearse) throw new RehearsalRollback({ deleted: result, totalsAfter });

            await tx.backfillImportBatch.update({
                where: { id: batchId },
                data: {
                    summary: {
                        ...prepared.summary,
                        // 画面の履歴には要らない大きな配列は控えから落とす
                        errors: [],
                        warnings: prepared.summary.warnings.slice(0, 20),
                        deleted: result,
                    } as unknown as Prisma.InputJsonValue,
                },
            });
            return { deleted: result, totalsAfter };
        },
        { timeout: 240_000, maxWait: 15_000 },
    );
    } catch (e) {
        if (!(e instanceof RehearsalRollback)) throw e;
        outcome = e.result;
    }

    return {
        batchId,
        written: {
            projects: prepared.projects.length,
            invoices: prepared.invoices.length,
            assignments: prepared.assignments.length,
            adjustments: prepared.adjustments.length,
        },
        deleted: outcome.deleted,
        totalsAfter: outcome.totalsAfter,
        rehearsed: !!options.rehearse,
    };
}

// ============================================================================
// 取り消し
// ============================================================================

export interface BackfillRollbackPreview {
    batchId: string;
    status: string;
    counts: { projects: number; invoices: number; assignments: number; adjustments: number };
    blocked: { externalKey: string | null; title: string; reason: string }[];
}

/**
 * このバッチで取り込んだ（上書きした）行の数を数える。
 * 再取り込みで上書きされた行は、最後に書いたバッチのものとして数える（取り消しても前のバッチの状態には戻らない）。
 */
export async function previewRollback(client: Client, batchId: string): Promise<BackfillRollbackPreview> {
    const batch = await client.backfillImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error('取り込みバッチが見つかりません');
    const [projects, invoices, assignments, adjustments] = await Promise.all([
        client.projectMaster.findMany({ where: { importBatchId: batchId, isBackfilled: true }, select: { id: true, externalKey: true, title: true } }),
        client.invoice.count({ where: { importBatchId: batchId, isBackfilled: true } }),
        client.projectAssignment.count({ where: { importBatchId: batchId, isBackfilled: true } }),
        client.revenueAdjustment.count({ where: { importBatchId: batchId } }),
    ]);
    const reasons = await findProjectsWithLiveData(client, projects.map((p) => p.id));
    return {
        batchId,
        status: batch.status,
        counts: { projects: projects.length - reasons.size, invoices, assignments, adjustments },
        blocked: projects.filter((p) => reasons.has(p.id)).map((p) => ({ externalKey: p.externalKey, title: p.title, reason: reasons.get(p.id)! })),
    };
}

/** バッチ単位で取り消す（このバッチの importBatchId が付いた過去データを消す） */
export async function rollbackBatch(
    prisma: PrismaClient,
    batchId: string,
    userId: string | null,
): Promise<BackfillRollbackPreview['counts']> {
    return prisma.$transaction(
        async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('dandolink-backfill-import'))`;
            const batch = await tx.backfillImportBatch.findUnique({ where: { id: batchId } });
            if (!batch) throw new Error('取り込みバッチが見つかりません');
            if (batch.status === 'rolled_back') throw new Error('このバッチは取り消し済みです');

            const [asg, inv, adj] = await Promise.all([
                tx.projectAssignment.deleteMany({ where: { importBatchId: batchId, isBackfilled: true } }),
                tx.invoice.deleteMany({ where: { importBatchId: batchId, isBackfilled: true } }),
                tx.revenueAdjustment.deleteMany({ where: { importBatchId: batchId } }),
            ]);
            const projects = await tx.projectMaster.findMany({ where: { importBatchId: batchId, isBackfilled: true }, select: { id: true } });
            const blocked = await findProjectsWithLiveData(tx, projects.map((p) => p.id));
            const deletable = projects.map((p) => p.id).filter((id) => !blocked.has(id));
            const pm = deletable.length
                ? await tx.projectMaster.deleteMany({ where: { id: { in: deletable }, isBackfilled: true } })
                : { count: 0 };

            await tx.backfillImportBatch.update({
                where: { id: batchId },
                data: { status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: userId },
            });
            return { projects: pm.count, invoices: inv.count, assignments: asg.count, adjustments: adj.count };
        },
        { timeout: 120_000, maxWait: 15_000 },
    );
}

/** 顧客名の比較キー（集計側で過去案件と売上調整を同じ顧客にまとめるため） */
export { normalizeCompanyName };
