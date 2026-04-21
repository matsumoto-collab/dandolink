import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { formatEstimate } from '@/lib/formatters';

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

        const version = await prisma.estimateVersion.findUnique({
            where: { estimateId_versionNumber: { estimateId: id, versionNumber: vNum } },
        });
        if (!version) return notFoundResponse('見積履歴');

        // Estimate 型と同じ形に整形（PDF 生成に再利用するため）
        const estimateLike = {
            id: version.estimateId,
            estimateNumber: version.estimateNumber,
            title: version.title,
            items: version.items,
            subtotal: version.subtotal,
            tax: version.tax,
            total: version.total,
            validUntil: version.validUntil,
            status: version.status,
            notes: version.notes,
            location: version.location,
            costTotal: version.costTotal,
            constructionPeriod: version.constructionPeriod,
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
            ...formatEstimate(estimateLike),
            versionNumber: version.versionNumber,
            versionCreatedAt: version.createdAt.toISOString(),
            versionCreatedBy: version.createdBy,
            versionCreatedByName: creator?.displayName ?? null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('見積履歴の取得', error);
    }
}
