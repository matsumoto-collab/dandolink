import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';
import { createInvoiceSchema, validateRequest } from '@/lib/validations';

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
            return NextResponse.json({
                data: enriched,
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
        const enriched = await Promise.all(invoices.map(inv => enrichInvoice(formatInvoice(inv))));
        return NextResponse.json(enriched, { headers: { 'Cache-Control': 'no-store' } });
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
        const { projectMasterId, projectId, projectMasterIds, customerId, estimateId, invoiceNumber, title, items, subtotal, tax, total, dueDate, status, paidDate, notes } = validation.data;

        // 複数案件IDの解決
        let resolvedPmIds: string[] = [];
        if (Array.isArray(projectMasterIds) && projectMasterIds.length > 0) {
            resolvedPmIds = projectMasterIds;
        } else if (projectMasterId || projectId) {
            resolvedPmIds = [(projectMasterId || projectId) as string];
        }

        if (resolvedPmIds.length === 0) {
            return validationErrorResponse('案件の選択は必須です');
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
                projectMasterId: resolvedPmIds[0], // 代表案件（後方互換）
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
            },
        });

        // 中間テーブルに案件を登録
        if (resolvedPmIds.length > 0) {
            await prisma.invoiceProjectMaster.createMany({
                data: resolvedPmIds.map((pmId, i) => ({
                    invoiceId: newInvoice.id,
                    projectMasterId: pmId,
                    sortOrder: i,
                })),
            });
        }

        const enriched = await enrichInvoice(formatInvoice(newInvoice));
        return NextResponse.json(enriched);
    } catch (error) {
        return serverErrorResponse('請求書の作成', error);
    }
}
