import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
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
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
        return NextResponse.json(invoices.map(formatInvoice), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求書一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const { projectMasterId, estimateId, invoiceNumber, title, items, subtotal, tax, total, dueDate, status, paidDate, notes } = body;

        if (!title) {
            return validationErrorResponse('タイトルは必須です');
        }

        // 請求番号: 指定がなければサーバー側で自動採番
        let finalInvoiceNumber = invoiceNumber;
        if (!finalInvoiceNumber) {
            const year = new Date().getFullYear();
            const prefix = `I${year}`;
            const latest = await prisma.invoice.findFirst({
                where: { invoiceNumber: { startsWith: prefix } },
                orderBy: { invoiceNumber: 'desc' },
                select: { invoiceNumber: true },
            });
            let nextSeq = 1;
            if (latest) {
                const seq = parseInt(latest.invoiceNumber.replace(prefix, ''), 10);
                if (!isNaN(seq)) nextSeq = seq + 1;
            }
            finalInvoiceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        }

        const newInvoice = await prisma.invoice.create({
            data: {
                projectMasterId: projectMasterId || null, estimateId: estimateId || null, invoiceNumber: finalInvoiceNumber, title,
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
