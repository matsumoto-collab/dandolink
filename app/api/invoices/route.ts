import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';
import { createInvoiceSchema, validateRequest } from '@/lib/validations';
import { createInvoiceVersion } from '@/lib/versions/snapshot';
import { createInvoiceWithRetry } from '@/lib/billing/createInvoiceWithRetry';
import { computePaymentSummary } from '@/lib/invoicePayments';

/** 請求書に紐付く案件マスタ情報を取得 */
async function getInvoiceProjectMasters(invoiceId: string) {
    const links = await prisma.invoiceProjectMaster.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
        select: { projectMasterId: true },
    });
    if (links.length === 0) return [];
    const pmIds = links.map(l => l.projectMasterId);
    const pms = await prisma.projectMaster.findMany({
        where: { id: { in: pmIds } },
        select: { id: true, title: true },
    });
    // sortOrder順を維持
    return pmIds.map(id => pms.find(p => p.id === id)).filter(Boolean) as Array<{ id: string; title: string }>;
}

/** 請求書レスポンスにprojectMasters情報を付与 */
async function enrichInvoice(invoice: ReturnType<typeof formatInvoice>) {
    const projectMasters = await getInvoiceProjectMasters(invoice.id as string);
    return {
        ...invoice,
        projectMasters,
        projectMasterIds: projectMasters.map(p => p.id),
    };
}

/** 請求書群の入金記録を一括取得し invoiceId→{amount,fee}[] のマップを返す（一覧の残額計算用・N+1回避） */
async function loadPaymentsByInvoice(invoiceIds: string[]) {
    const map = new Map<string, Array<{ amount: number; fee: number }>>();
    if (invoiceIds.length === 0) return map;
    const rows = await prisma.invoicePayment.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { invoiceId: true, amount: true, fee: true },
    });
    for (const r of rows) {
        const arr = map.get(r.invoiceId) ?? [];
        arr.push({ amount: Number(r.amount), fee: Number(r.fee) });
        map.set(r.invoiceId, arr);
    }
    return map;
}

/**
 * enrich 済み請求書に入金サマリ（paymentSummary）を付与する。
 * total/status は生の請求書（rawInvoices）から引く
 * （formatInvoice の戻り型に status が含まれないため）。
 */
function attachPaymentSummaries<E extends { id: string }>(
    enriched: E[],
    rawInvoices: Array<{ id: string; total: unknown; status: string }>,
    paymentsMap: Map<string, Array<{ amount: number; fee: number }>>
) {
    const rawById = new Map(rawInvoices.map((r) => [r.id, r] as const));
    return enriched.map((inv) => ({
        ...inv,
        paymentSummary: computePaymentSummary(
            Number(rawById.get(inv.id)?.total ?? 0),
            paymentsMap.get(inv.id) ?? [],
            rawById.get(inv.id)?.status
        ),
    }));
}

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        if (page && limit) {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
                return validationErrorResponse('無効なページネーションパラメータです');
            }
            const [invoices, total] = await Promise.all([
                prisma.invoice.findMany({ skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { createdAt: 'desc' } }),
                prisma.invoice.count(),
            ]);
            const enriched = await Promise.all(invoices.map(inv => enrichInvoice(formatInvoice(inv))));
            const paymentsMap = await loadPaymentsByInvoice(invoices.map(i => i.id));
            const withSummary = attachPaymentSummaries(enriched, invoices, paymentsMap);
            return NextResponse.json({
                data: withSummary,
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
        const enriched = await Promise.all(invoices.map(inv => enrichInvoice(formatInvoice(inv))));
        const paymentsMap = await loadPaymentsByInvoice(invoices.map(i => i.id));
        const withSummary = attachPaymentSummaries(enriched, invoices, paymentsMap);
        return NextResponse.json(withSummary, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求書一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(createInvoiceSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);
        const { projectMasterId, projectId, projectMasterIds, customerId, estimateId, invoiceNumber, title, items, subtotal, tax, total, dueDate, status, paidDate, notes, createdAt } = validation.data;

        // 複数案件IDの解決
        let resolvedPmIds: string[] = [];
        if (Array.isArray(projectMasterIds) && projectMasterIds.length > 0) {
            resolvedPmIds = projectMasterIds;
        } else if (projectMasterId || projectId) {
            resolvedPmIds = [(projectMasterId || projectId) as string];
        }

        // 案件なしの請求書も許可する（明細の見出しは items 内に保持する）。
        // resolvedPmIds が空のときは代表案件 null・中間テーブルなしで作成する。

        // Invoice 作成本体（採番済み番号を受け取る）。手動 POST / Phase 3 で共通の処理。
        const runCreate = async (tx: Prisma.TransactionClient, finalInvoiceNumber: string) => {
            const created = await tx.invoice.create({
                data: {
                    projectMasterId: resolvedPmIds[0] || null, // 代表案件（後方互換・案件なしは null）
                    customerId: customerId || null,
                    estimateId: estimateId || null,
                    invoiceNumber: finalInvoiceNumber,
                    title,
                    items: JSON.stringify(items || []),
                    subtotal: subtotal || 0, tax: tax || 0, total: total || 0,
                    dueDate: dueDate ? new Date(dueDate) : new Date(),
                    status: status || 'draft',
                    paidDate: paidDate ? new Date(paidDate) : null,
                    notes: notes || null,
                    updatedBy: session!.user.id,
                    ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
                },
            });
            if (resolvedPmIds.length > 0) {
                await tx.invoiceProjectMaster.createMany({
                    data: resolvedPmIds.map((pmId, i) => ({
                        invoiceId: created.id,
                        projectMasterId: pmId,
                        sortOrder: i,
                    })),
                });
            }
            await createInvoiceVersion(tx, created.id, session!.user.id);
            return created;
        };

        // 採番: 明示指定があればその番号で作成。無指定なら自動採番 + 衝突リトライ（advisory lock）。
        // 採番ロジックは lib/billing/createInvoiceWithRetry に集約（§17.27.6、無リトライ問題の解消）。
        const newInvoice = invoiceNumber
            ? await prisma.$transaction((tx) => runCreate(tx, invoiceNumber))
            : await createInvoiceWithRetry(runCreate);

        const enriched = await enrichInvoice(formatInvoice(newInvoice));
        return NextResponse.json(enriched);
    } catch (error) {
        return serverErrorResponse('請求書の作成', error);
    }
}
