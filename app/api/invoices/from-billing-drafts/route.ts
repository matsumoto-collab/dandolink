import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { issueInvoiceFromDraftsSchema, validateRequest } from '@/lib/validations';
import { formatInvoice } from '@/lib/formatters';
import { createInvoiceVersion } from '@/lib/versions/snapshot';
import { createInvoiceWithRetry } from '@/lib/billing/createInvoiceWithRetry';
import { billingDraftToInvoiceItem } from '@/lib/billing/draftToInvoiceItem';
import type { InvoiceItem } from '@/types/invoice';

const TAX_RATE = 0.1;

/**
 * 明細から 小計 / 税額 / 合計 を算出する。
 * 既存 InvoiceForm（components/Invoices/InvoiceForm.tsx:333-337）と同一ルール：
 * 課税明細（taxType==='standard'）の合計 × 10% を Math.floor（請求書単位で 1 回）。
 * 8% 軽減税率は扱わない（D-d 確定）。
 */
function computeTotals(items: InvoiceItem[]): { subtotal: number; tax: number; total: number } {
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const subtotal = items.reduce((sum, it) => sum + num(it.amount), 0);
    const taxable = items
        .filter((it) => it.taxType === 'standard')
        .reduce((sum, it) => sum + num(it.amount), 0);
    const tax = Math.floor(taxable * TAX_RATE);
    return { subtotal, tax, total: subtotal + tax };
}

/**
 * Phase 3: 請求予定（pending な BillingDraft 群）→ Invoice をアトミックに発行する。
 * POST /api/invoices/from-billing-drafts
 *
 * トランザクション内（createInvoiceWithRetry 経由、採番リトライ + advisory lock 付き）で：
 *   1. Invoice 作成（items を InvoiceItem[] の JSON で直列化、subtotal/tax/total はサーバー算出）
 *   2. InvoiceProjectMaster 作成（projectMasterId を dedup、案件あたり 1 行）
 *   3. 対象 BillingDraft を status='confirmed' + invoiceId 紐づけ
 *   4. createInvoiceVersion でバージョン履歴スナップショット（既存踏襲）
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(issueInvoiceFromDraftsSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }
        const { billingDraftIds, title, dueDate, status, notes, items: bodyItems } = validation.data;

        // 対象 draft を取得して整合性を検証
        const drafts = await prisma.billingDraft.findMany({
            where: { id: { in: billingDraftIds } },
        });

        if (drafts.length !== billingDraftIds.length) {
            return validationErrorResponse('指定された請求予定の一部が見つかりません');
        }
        if (drafts.some((d) => d.deletedAt !== null)) {
            return validationErrorResponse('削除済みの請求予定が含まれています');
        }
        if (drafts.some((d) => d.status !== 'pending')) {
            return validationErrorResponse('保留中（pending）以外の請求予定が含まれています');
        }
        const customerIds = Array.from(new Set(drafts.map((d) => d.customerId)));
        if (customerIds.length > 1) {
            return validationErrorResponse('複数の顧客の請求予定が混在しています。1 顧客ずつ請求書化してください');
        }
        const customerId = customerIds[0];

        // 明細・確定対象の決定（D-c / D-f）
        // - クライアントが編集済み items を明示送信 → それを尊重し、全 draft を確定対象にする
        // - items 省略時 → サーバーが draft から生成。金額未入力（null）は既定で除外（D-f）
        const useClientItems = Array.isArray(bodyItems) && bodyItems.length > 0;
        let items: InvoiceItem[];
        let sourceDrafts: typeof drafts;
        if (useClientItems) {
            items = bodyItems as InvoiceItem[];
            sourceDrafts = drafts;
        } else {
            const billable = drafts.filter((d) => d.amount !== null);
            if (billable.length === 0) {
                return validationErrorResponse('金額が入力された請求予定がありません');
            }
            items = billable.map(billingDraftToInvoiceItem);
            sourceDrafts = billable;
        }

        const confirmDraftIds = sourceDrafts.map((d) => d.id);
        const uniquePmIds = Array.from(new Set(sourceDrafts.map((d) => d.projectId)));
        const { subtotal, tax, total } = computeTotals(items);

        const created = await createInvoiceWithRetry(async (tx, invoiceNumber) => {
            const invoice = await tx.invoice.create({
                data: {
                    invoiceNumber,
                    title: title.trim(),
                    items: JSON.stringify(items),
                    subtotal,
                    tax,
                    total,
                    dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    status: status || 'draft',
                    notes: notes?.trim() || null,
                    customerId,
                    projectMasterId: uniquePmIds[0] || null, // 代表案件（後方互換）
                    updatedBy: session!.user.id,
                },
            });

            if (uniquePmIds.length > 0) {
                await tx.invoiceProjectMaster.createMany({
                    data: uniquePmIds.map((pmId, i) => ({
                        invoiceId: invoice.id,
                        projectMasterId: pmId,
                        sortOrder: i,
                    })),
                });
            }

            // 対象 draft を確定（pending→confirmed）。改ざん防止トリガは status/invoiceId 変更を許可。
            await tx.billingDraft.updateMany({
                where: { id: { in: confirmDraftIds } },
                data: { status: 'confirmed', invoiceId: invoice.id },
            });

            await createInvoiceVersion(tx, invoice.id, session!.user.id);
            return invoice;
        });

        return NextResponse.json(formatInvoice(created), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定からの請求書発行', error);
    }
}
