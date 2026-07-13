import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { extractSupplierInvoice } from '@/lib/supplierInvoiceExtract';
import { parseReceiptDate } from '@/lib/receipt';
import { SUPPLIER_INVOICE_INCLUDE, findMatchingPayee } from '@/lib/supplierInvoice';

// Claude による再読み取りに時間がかかるため延長（Vercel Pro: 最大300s）
export const maxDuration = 60;

interface RouteContext { params: Promise<{ id: string }>; }

// 保存済みファイルのAI再読み取り。支払予定に追加済みの行は対象外（支払予定側が正のため）。
export async function POST(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const { id } = await context.params;
        const invoice = await prisma.supplierInvoice.findUnique({ where: { id } });
        if (!invoice) return notFoundResponse('請求書');
        if (invoice.paymentScheduleId) return errorResponse('支払予定に追加済みの請求書は再読み取りできません', 400);

        const { data: file, error: dlErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(invoice.storagePath);
        if (dlErr || !file) return errorResponse('元ファイルの取得に失敗しました', 500);

        const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
        const extracted = await extractSupplierInvoice(base64, invoice.mimeType);

        // 再読み取り結果で振込先マスターを照合し直す（完全一致のみ）
        const payee = await findMatchingPayee(prisma, {
            accountNumber: extracted.accountNumber,
            payeeName: extracted.payeeName,
        });

        const updated = await prisma.supplierInvoice.update({
            where: { id },
            data: {
                payeeName: extracted.payeeName,
                payeeKana: extracted.payeeKana,
                bankName: extracted.bankName,
                branchName: extracted.branchName,
                accountType: extracted.accountType,
                accountNumber: extracted.accountNumber,
                accountHolder: extracted.accountHolder,
                issueDate: parseReceiptDate(extracted.issueDate),
                dueDate: parseReceiptDate(extracted.dueDate),
                totalAmount: extracted.totalAmount,
                taxAmount: extracted.taxAmount,
                registrationNumber: extracted.registrationNumber,
                payeeId: payee?.id ?? null,
                extractedData: extracted as unknown as Prisma.InputJsonValue,
                updatedBy: session!.user.id,
            },
            include: SUPPLIER_INVOICE_INCLUDE,
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('請求書の再読み取り', error);
    }
}
