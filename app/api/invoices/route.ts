import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
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
            return NextResponse.json({
                data: invoices.map(formatInvoice),
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            });
        }

        const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
        return NextResponse.json(invoices.map(formatInvoice));
    } catch (error) {
        return serverErrorResponse('請求書一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const body = await req.json();
        const { projectMasterId, estimateId, invoiceNumber, title, items, subtotal, tax, total, dueDate, status, paidDate, notes } = body;

        if (!projectMasterId || !invoiceNumber || !title) {
            return validationErrorResponse('案件ID、請求書番号、タイトルは必須です');
        }

        const newInvoice = await prisma.invoice.create({
            data: {
                projectMasterId, estimateId: estimateId || null, invoiceNumber, title,
                items: JSON.stringify(items || []), subtotal: subtotal || 0, tax: tax || 0, total: total || 0,
                dueDate: dueDate ? new Date(dueDate) : new Date(), status: status || 'draft',
                paidDate: paidDate ? new Date(paidDate) : null, notes: notes || null,
            },
        });

        return NextResponse.json(formatInvoice(newInvoice));
    } catch (error) {
        return serverErrorResponse('請求書の作成', error);
    }
}
