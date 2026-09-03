/**
 * 受注明細書（信用保証協会様式）の候補抽出（仕様書 §3.6）。
 *
 * 「請求が終わっていない案件」を DB から拾って、画面がそのまま編集できる明細行（円）に落とす。
 * lib/orderBacklog の他のファイルは prisma を持たない純粋ロジックで、prisma を触るのは
 * このファイルと server.ts だけ。
 *
 * 集計の考え方（請求待ちボード app/api/billing-board/route.ts と同じ土俵に乗せる）:
 * - 契約額の分母は `resolveBillingBasis`（選択見積 → 単一見積 → contractAmount）で解決した **税抜**。
 *   受注明細書は税込で出す運用なので taxMode='inclusive' のときだけ消費税を乗せる。
 * - 請求済み判定は `computeInvoicedByProject`（明細 amount＝税抜の案件別合算）と比較する。
 * - 既受領は「請求書に入った入金（InvoicePayment）」を案件へ按分したもの。まとめ請求は
 *   `invoicedAmountForProject / subtotal` の比で分ける。
 *
 * N+1 を作らないため、案件・配置・見積・請求書・入金・顧客・工事種別はすべて一括で読む。
 */
import { prisma } from '@/lib/prisma';
import type { DueDatePreset } from '@/lib/closingDay';
import {
    computeInvoicedByProject,
    getBillingStatus,
    invoicedAmountForProject,
    resolveBillingBasis,
    type InvoiceForBillingSummary,
} from '@/lib/billing/billingStatus';
import { parseJsonField } from '@/lib/json-utils';
import { siteKindFromProject, workKindFromConstructionContent } from '@/lib/orderBacklog/classify';
import {
    proposeProgressRate,
    proposeSchedule,
    proposeStartEndYm,
    type ProposeAssignment,
} from '@/lib/orderBacklog/propose';
import type { OrderBacklogLineInput, TaxMode } from '@/lib/orderBacklog/types';

/**
 * 消費税率（10%）。
 * 全社共通の定数は無く、`types/partnerWorkVolume.ts` の PARTNER_TAX_RATE は
 * 協力業者出来高の税区分専用なので、受注明細書側で持つ。
 */
export const ORDER_BACKLOG_TAX_RATE = 0.1;

/** 候補から外れた・値が埋まらなかった案件の注意書き（画面にそのまま出す）。 */
export interface OrderBacklogCandidateWarning {
    projectMasterId: string;
    projectName: string;
    message: string;
}

export interface BuildOrderBacklogCandidatesParams {
    /** 基準日 'YYYY-MM-DD' */
    asOf: string;
    taxMode: TaxMode;
    /**
     * 指定するとフィルタ（請求済み・古い案件）を無視してこの案件だけを計算する。
     * 画面の「案件を追加」「入金予定を再提案」から使う。
     */
    projectMasterIds?: string[];
}

export interface OrderBacklogCandidatesResult {
    lines: OrderBacklogLineInput[];
    warnings: OrderBacklogCandidateWarning[];
}

/** 候補に載せない案件のステータス（中止案件は銀行に出さない）。 */
const EXCLUDED_PROJECT_STATUS = 'cancelled';

/** 最後の配置がこの月数より前なら「古い案件」として候補から外す。手で足すことはできる。 */
const STALE_MONTHS = 6;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ProjectAssignment.date（JST 0時 = UTC 前日15時）から JST の 'YYYY-MM-DD' を取り出す。 */
function jstYmd(date: Date): string {
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' の JST 0時を UTC instant に直す（配置の範囲クエリ用）。 */
function jstInstant(ymd: string): Date {
    return new Date(`${ymd}T00:00:00+09:00`);
}

/** 'YYYY-MM-DD' に月を足した 'YYYY-MM-DD'（月末は Date.UTC の正規化に任せる）。 */
function addMonthsYmd(ymd: string, months: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + months, d));
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 顧客の入金サイト。DB は自由文字列なので DueDatePreset に当たるものだけ通す。 */
function toDuePreset(value: string | null | undefined): DueDatePreset | null {
    return value === 'nextMonthEnd' || value === 'secondMonth10' || value === 'secondMonth15'
        ? value
        : null;
}

/**
 * 基準額（税抜）から様式に出す契約額（円）を出す。
 * 税込運用なら消費税を乗せて四捨五入。基準額が決められない案件は 0（画面で手入力してもらう）。
 */
export function contractAmountFromBasis(basisAmount: number | null, taxMode: TaxMode): number {
    if (basisAmount == null || !Number.isFinite(basisAmount)) return 0;
    const yen = taxMode === 'inclusive' ? basisAmount * (1 + ORDER_BACKLOG_TAX_RATE) : basisAmount;
    return Math.round(yen);
}

/** receivedAmountForProject が受け取る請求書の最小形（入金つき）。 */
export interface InvoiceWithPayments extends InvoiceForBillingSummary {
    id: string;
    /** 入金（振込手数料は当社負担＝入金と同じく受領済みとして足す） */
    payments: { amount: number; fee: number }[];
}

/**
 * 案件の既受領金額（円）。
 *
 * 入金は請求書単位でしか記録されないので、まとめ請求は「その請求書のうちこの案件ぶんの割合」
 * （案件別の税抜請求額 ÷ 税抜小計）で按分する。単独請求ならこの比が 1 になるので式は共通。
 * cancelled の請求書と、小計 0（按分できない）の請求書は数えない。
 */
export function receivedAmountForProject(
    invoices: readonly InvoiceWithPayments[],
    projectMasterId: string,
): number {
    let total = 0;
    for (const inv of invoices) {
        if (inv.status === 'cancelled') continue;
        const paid = inv.payments.reduce((s, p) => s + p.amount + p.fee, 0);
        if (paid === 0) continue;
        const subtotal = Number(inv.subtotal) || 0;
        if (subtotal <= 0) continue;
        const share = invoicedAmountForProject(inv, projectMasterId) / subtotal;
        if (share <= 0) continue;
        total += paid * share;
    }
    return Math.round(total);
}

/**
 * 受注明細書の候補行を作る（仕様書 §3.6）。
 *
 * 既定（projectMasterIds なし）の抽出条件:
 * - status が cancelled でない ProjectMaster で、配置が 1 件以上ある
 * - 最後の配置日が 基準日−6か月 以降（古い案件は「案件を追加」から手で足せる）
 * - 請求済み判定が 'full'（基準額 ≤ 請求済み合計・どちらも税抜）でない
 *
 * projectMasterIds を渡すとこれらの条件を全て無視して、その案件だけを計算する。
 */
export async function buildOrderBacklogCandidates(
    params: BuildOrderBacklogCandidatesParams,
): Promise<OrderBacklogCandidatesResult> {
    const { asOf, taxMode } = params;
    const manualIds = params.projectMasterIds?.filter((id) => !!id) ?? [];
    const isManual = manualIds.length > 0;

    // 手動指定は「その案件だけ」。既定は 6 か月以内に配置がある案件（＝最後の配置日が閾値以降）を DB 側で絞る
    const staleFrom = jstInstant(addMonthsYmd(asOf, -STALE_MONTHS));
    const projects = await prisma.projectMaster.findMany({
        where: isManual
            ? { id: { in: manualIds } }
            : {
                  status: { not: EXCLUDED_PROJECT_STATUS },
                  assignments: { some: { date: { gte: staleFrom } } },
              },
        select: {
            id: true,
            title: true,
            name: true,
            honorific: true,
            customerId: true,
            customerName: true,
            constructionContent: true,
            contractAmount: true,
            billingEstimateIds: true,
        },
    });

    if (projects.length === 0) return { lines: [], warnings: [] };
    const projectIds = projects.map((p) => p.id);

    const [assignments, estimates, constructionTypes, customers, invoiceLinks, invoices] =
        await Promise.all([
            prisma.projectAssignment.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { projectMasterId: true, date: true, constructionType: true },
                orderBy: { date: 'asc' },
            }),
            prisma.estimate.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { id: true, projectMasterId: true, subtotal: true },
            }),
            prisma.constructionType.findMany({ select: { id: true, name: true } }),
            prisma.customer.findMany({
                select: { id: true, name: true, closingDay: true, paymentDuePreset: true },
            }),
            prisma.invoiceProjectMaster.findMany({
                where: { projectMasterId: { in: projectIds } },
                select: { invoiceId: true, projectMasterId: true },
            }),
            // 請求書は全件（本番でも数百件）。請求済み合計は案件別に按分するので、
            // 案件で先に絞ると「まとめ請求のうちこの案件ぶん」を取りこぼす経路が生まれる。
            prisma.invoice.findMany({
                select: {
                    id: true,
                    status: true,
                    subtotal: true,
                    items: true,
                    projectMasterId: true,
                    payments: { select: { amount: true, fee: true } },
                },
            }),
        ]);

    // 工事種別は ID で入っている配置と名前で入っている配置が混在しているので、名前に寄せてから propose に渡す
    const ctypeNameById = new Map(constructionTypes.map((c) => [c.id, c.name]));
    const assignmentsByProject = new Map<string, ProposeAssignment[]>();
    for (const a of assignments) {
        const raw = a.constructionType ?? null;
        const entry: ProposeAssignment = {
            date: jstYmd(a.date),
            constructionType: raw ? (ctypeNameById.get(raw) ?? raw) : null,
        };
        const arr = assignmentsByProject.get(a.projectMasterId);
        if (arr) arr.push(entry);
        else assignmentsByProject.set(a.projectMasterId, [entry]);
    }

    const estimatesByProject = new Map<string, { id: string; subtotal: number }[]>();
    for (const e of estimates) {
        if (!e.projectMasterId) continue;
        const entry = { id: e.id, subtotal: Number(e.subtotal) || 0 };
        const arr = estimatesByProject.get(e.projectMasterId);
        if (arr) arr.push(entry);
        else estimatesByProject.set(e.projectMasterId, [entry]);
    }

    const customerById = new Map(customers.map((c) => [c.id, c]));

    // 請求書を集計用に正規化（items は JSON 文字列）
    const normalizedInvoices: InvoiceWithPayments[] = invoices.map((inv) => ({
        id: inv.id,
        status: inv.status,
        subtotal: Number(inv.subtotal) || 0,
        items: parseJsonField<InvoiceForBillingSummary['items']>(inv.items, []),
        projectMasterId: inv.projectMasterId,
        payments: inv.payments.map((p) => ({ amount: Number(p.amount) || 0, fee: Number(p.fee) || 0 })),
    }));
    const invoicedByProject = computeInvoicedByProject(normalizedInvoices);

    // 案件 → その案件に紐づく請求書（InvoiceProjectMaster の関連 ＋ Invoice.projectMasterId の直接紐付け）
    const invoiceById = new Map(normalizedInvoices.map((inv) => [inv.id, inv]));
    const invoicesByProject = new Map<string, InvoiceWithPayments[]>();
    const addInvoice = (pmId: string, inv: InvoiceWithPayments) => {
        const arr = invoicesByProject.get(pmId);
        if (!arr) invoicesByProject.set(pmId, [inv]);
        else if (!arr.some((x) => x.id === inv.id)) arr.push(inv);
    };
    for (const link of invoiceLinks) {
        const inv = invoiceById.get(link.invoiceId);
        if (inv) addInvoice(link.projectMasterId, inv);
    }
    const projectIdSet = new Set(projectIds);
    for (const inv of normalizedInvoices) {
        if (inv.projectMasterId && projectIdSet.has(inv.projectMasterId)) addInvoice(inv.projectMasterId, inv);
    }

    const warnings: OrderBacklogCandidateWarning[] = [];
    const lines: OrderBacklogLineInput[] = [];

    for (const pm of projects) {
        const projectName = pm.title || pm.name || '(名称未設定)';
        const asg = assignmentsByProject.get(pm.id) ?? [];
        if (asg.length === 0 && !isManual) continue; // 配置が無い案件は候補にしない

        const basis = resolveBillingBasis({
            contractAmount: pm.contractAmount ?? null,
            billingEstimateIds: pm.billingEstimateIds,
            estimates: estimatesByProject.get(pm.id) ?? [],
        });

        // 請求済み（'full'）は候補から外す。手動指定のときは条件を無視する
        if (!isManual && getBillingStatus(basis.amount, invoicedByProject[pm.id] ?? 0) === 'full') {
            continue;
        }

        const contractAmount = contractAmountFromBasis(basis.amount, taxMode);
        if (basis.amount == null) {
            warnings.push({
                projectMasterId: pm.id,
                projectName,
                message: '契約額が未設定（見積なし）',
            });
        }

        const customer = pm.customerId ? customerById.get(pm.customerId) : undefined;
        const preset = toDuePreset(customer?.paymentDuePreset);
        if (!preset) {
            warnings.push({
                projectMasterId: pm.id,
                projectName,
                message: '入金サイト未設定（翌月末で計算）',
            });
        }

        const receivedAmount = receivedAmountForProject(invoicesByProject.get(pm.id) ?? [], pm.id);
        const { startYm, endYm } = proposeStartEndYm(asg);

        lines.push({
            projectMasterId: pm.id,
            customerName: pm.customerName || customer?.name || '',
            projectName,
            workKind: workKindFromConstructionContent(pm.constructionContent),
            siteKind: siteKindFromProject({ honorific: pm.honorific, name: pm.name, title: pm.title }),
            contractAmount,
            startYm,
            endYm,
            progressRate: proposeProgressRate(asg, asOf),
            receivedAmount,
            schedule: proposeSchedule({
                contractAmount,
                receivedAmount,
                assignments: asg,
                closingDay: customer?.closingDay ?? null,
                preset,
                asOf,
            }),
            excluded: false,
            isManual,
            sortOrder: 0,
        });
    }

    // 契約額の降順（様式も金額の大きい順に並んでいる）。同額は案件名で安定させる
    lines.sort((a, b) => b.contractAmount - a.contractAmount || a.projectName.localeCompare(b.projectName, 'ja'));
    lines.forEach((line, index) => {
        line.sortOrder = index;
    });

    return { lines, warnings };
}
