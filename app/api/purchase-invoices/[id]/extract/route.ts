import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { extractPurchaseInvoice } from '@/lib/purchaseInvoiceExtract';
import { parseInvoiceDate, INVOICE_INCLUDE } from '@/lib/purchaseInvoice';

interface RouteContext { params: Promise<{ id: string }>; }

// 保存済みの請求書ファイルを Claude で再読み取りし、抽出値を埋め直す（未確定の請求書向け）。
export async function POST(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const inv = await prisma.purchaseInvoice.findUnique({ where: { id } });
        if (!inv) return notFoundResponse('仕入請求書');
        if (inv.status === 'confirmed') return errorResponse('確定済みの請求書は再読み取りできません', 400);

        const { data, error: dErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(inv.storagePath);
        if (dErr || !data) return errorResponse('ファイルの取得に失敗しました', 500);
        const base64 = Buffer.from(await data.arrayBuffer()).toString('base64');

        const extracted = await extractPurchaseInvoice(base64, inv.mimeType);

        let expenseCategoryId = inv.expenseCategoryId;
        if (!expenseCategoryId && extracted.suggestedCategory) {
            const cats = await prisma.expenseCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } });
            const hint = extracted.suggestedCategory;
            expenseCategoryId = cats.find((c) => hint.includes(c.name) || c.name.includes(hint))?.id ?? null;
        }

        // 既存明細を抽出結果で置き換える
        await prisma.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: id } });
        const updated = await prisma.purchaseInvoice.update({
            where: { id },
            data: {
                extractedData: extracted as unknown as Prisma.InputJsonValue,
                payeeName: extracted.payeeName ?? inv.payeeName,
                payeeKana: extracted.payeeKana ?? inv.payeeKana,
                bankName: extracted.bankName ?? inv.bankName,
                branchName: extracted.branchName ?? inv.branchName,
                accountType: extracted.accountType ?? inv.accountType,
                accountNumber: extracted.accountNumber ?? inv.accountNumber,
                accountHolder: extracted.accountHolder ?? inv.accountHolder,
                issueDate: parseInvoiceDate(extracted.issueDate) ?? inv.issueDate,
                dueDate: parseInvoiceDate(extracted.dueDate) ?? inv.dueDate,
                totalAmount: extracted.totalAmount ?? inv.totalAmount,
                taxAmount: extracted.taxAmount ?? inv.taxAmount,
                expenseCategoryId,
                items:
                    extracted.items.length > 0
                        ? { create: extracted.items.map((it, i) => ({ name: it.name, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, amount: it.amount, sortOrder: i })) }
                        : undefined,
            },
            include: INVOICE_INCLUDE,
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('仕入請求書の再読み取り', error);
    }
}
