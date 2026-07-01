import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { createInvoicePaymentSchema, validateRequest } from '@/lib/validations';
import { computePaymentSummary } from '@/lib/invoicePayments';
import { formatInvoicePayment } from '@/lib/invoicePaymentsServer';

interface RouteContext { params: Promise<{ id: string }>; }

/** 指定請求書の入金一覧＋サマリを組み立てる */
async function buildPaymentsResponse(invoiceId: string, total: number, status: string) {
    const payments = await prisma.invoicePayment.findMany({
        where: { invoiceId },
        orderBy: { paidDate: 'asc' },
    });
    const formatted = payments.map(formatInvoicePayment);
    const summary = computePaymentSummary(total, formatted, status);
    return { payments: formatted, summary };
}

// GET: 請求書の入金一覧＋残額サマリ
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const invoice = await prisma.invoice.findUnique({ where: { id }, select: { total: true, status: true } });
        if (!invoice) return notFoundResponse('請求書');

        const res = await buildPaymentsResponse(id, Number(invoice.total), invoice.status);
        return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('入金記録の取得', error);
    }
}

// POST: 入金を1件記録（分割入金は複数回POST）。status は自動更新しない（入金は別軸管理）。
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const invoice = await prisma.invoice.findUnique({ where: { id }, select: { total: true, status: true } });
        if (!invoice) return notFoundResponse('請求書');

        const body = await req.json();
        const validation = validateRequest(createInvoicePaymentSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);
        const data = validation.data;

        await prisma.invoicePayment.create({
            data: {
                invoiceId: id,
                paidDate: new Date(data.paidDate),
                amount: data.amount ?? 0,
                fee: data.fee ?? 0,
                method: data.method || null,
                note: data.note || null,
                createdBy: session!.user.id,
            },
        });

        const res = await buildPaymentsResponse(id, Number(invoice.total), invoice.status);
        return NextResponse.json(res);
    } catch (error) {
        return serverErrorResponse('入金の登録', error);
    }
}
