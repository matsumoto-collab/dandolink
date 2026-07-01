import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { computePaymentSummary } from '@/lib/invoicePayments';
import { formatInvoicePayment } from '@/lib/invoicePaymentsServer';

interface RouteContext { params: Promise<{ id: string; paymentId: string }>; }

// DELETE: 入金記録を1件取り消す。取消後の最新一覧＋サマリを返す。
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id, paymentId } = await context.params;
        const payment = await prisma.invoicePayment.findUnique({ where: { id: paymentId } });
        // URL の請求書IDと入金記録の所属が一致しない場合も 404（他請求書の入金を消させない）
        if (!payment || payment.invoiceId !== id) return notFoundResponse('入金記録');

        await prisma.invoicePayment.delete({ where: { id: paymentId } });

        const invoice = await prisma.invoice.findUnique({ where: { id }, select: { total: true, status: true } });
        const payments = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, orderBy: { paidDate: 'asc' } });
        const formatted = payments.map(formatInvoicePayment);
        const summary = invoice ? computePaymentSummary(Number(invoice.total), formatted, invoice.status) : null;
        return NextResponse.json({ payments: formatted, summary });
    } catch (error) {
        return serverErrorResponse('入金記録の削除', error);
    }
}
