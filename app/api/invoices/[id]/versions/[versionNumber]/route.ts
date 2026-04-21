import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';

interface RouteContext { params: Promise<{ id: string; versionNumber: string }>; }

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id, versionNumber } = await context.params;
        const vNum = parseInt(versionNumber, 10);
        if (isNaN(vNum) || vNum < 1) {
            return validationErrorResponse('バージョン番号が不正です');
        }

        const version = await prisma.invoiceVersion.findUnique({
            where: { invoiceId_versionNumber: { invoiceId: id, versionNumber: vNum } },
        });
        if (!version) return notFoundResponse('請求書履歴');

        let pmIds: string[] = [];
        try {
            const parsed = JSON.parse(version.projectMasterIdsJson);
            if (Array.isArray(parsed)) pmIds = parsed.filter((v): v is string => typeof v === 'string');
        } catch {
            pmIds = [];
        }

        const projectMasters = pmIds.length > 0
            ? await prisma.projectMaster.findMany({
                where: { id: { in: pmIds } },
                select: { id: true, title: true },
            })
            : [];
        // pmIds の順序維持
        const orderedPms = pmIds.map(i => projectMasters.find(p => p.id === i)).filter(Boolean) as Array<{ id: string; title: string }>;

        const invoiceLike = {
            id: version.invoiceId,
            invoiceNumber: version.invoiceNumber,
            title: version.title,
            items: version.items,
            subtotal: version.subtotal,
            tax: version.tax,
            total: version.total,
            dueDate: version.dueDate,
            status: version.status,
            paidDate: version.paidDate,
            notes: version.notes,
            estimateId: version.estimateId,
            projectMasterId: version.projectMasterId,
            customerId: version.customerId,
            createdAt: version.createdAt,
            updatedAt: version.createdAt,
            updatedBy: version.createdBy,
        };

        const creator = version.createdBy
            ? await prisma.user.findUnique({ where: { id: version.createdBy }, select: { displayName: true } })
            : null;

        return NextResponse.json({
            ...formatInvoice(invoiceLike),
            projectMasters: orderedPms,
            projectMasterIds: orderedPms.map(p => p.id),
            versionNumber: version.versionNumber,
            versionCreatedAt: version.createdAt.toISOString(),
            versionCreatedBy: version.createdBy,
            versionCreatedByName: creator?.displayName ?? null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求書履歴の取得', error);
    }
}
