import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get all invoices
 * GET /api/invoices
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const invoices = await prisma.invoice.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Parse JSON fields
        const parsedInvoices = invoices.map((invoice: any) => ({
            ...invoice,
            items: invoice.items ? JSON.parse(invoice.items) : [],
            dueDate: new Date(invoice.dueDate),
            paidDate: invoice.paidDate ? new Date(invoice.paidDate) : null,
        }));

        return NextResponse.json(parsedInvoices);
    } catch (error) {
        console.error('Get invoices error:', error);
        return NextResponse.json(
            { error: '請求書一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Create a new invoice
 * POST /api/invoices
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const body = await req.json();
        const {
            projectId,
            estimateId,
            invoiceNumber,
            title,
            items,
            subtotal,
            tax,
            total,
            dueDate,
            status,
            paidDate,
            notes,
        } = body;

        // Validation
        if (!projectId || !invoiceNumber || !title) {
            return NextResponse.json(
                { error: '案件ID、請求書番号、タイトルは必須です' },
                { status: 400 }
            );
        }

        // Create invoice
        const newInvoice = await prisma.invoice.create({
            data: {
                projectId,
                estimateId: estimateId || null,
                invoiceNumber,
                title,
                items: items ? JSON.stringify(items) : '[]',
                subtotal: subtotal || 0,
                tax: tax || 0,
                total: total || 0,
                dueDate: dueDate ? new Date(dueDate) : new Date(),
                status: status || 'draft',
                paidDate: paidDate ? new Date(paidDate) : null,
                notes: notes || null,
            },
        });

        // Parse JSON fields for response
        const response = {
            ...newInvoice,
            items: newInvoice.items ? JSON.parse(newInvoice.items) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Create invoice error:', error);
        return NextResponse.json(
            { error: '請求書の作成に失敗しました' },
            { status: 500 }
        );
    }
}
