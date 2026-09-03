import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    deleteSuccessResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations';
import { orderBacklogReportSchema } from '@/lib/validations/orderBacklog';
import { loadOrderBacklogReport } from '@/lib/orderBacklog/server';
import { requireOrderBacklogAdmin, toAsOfDate, toLineCreateData } from '../../_shared';

/**
 * GET /api/order-backlog/reports/[id]
 * 保存済みの受注明細書を明細つきで返す（admin 限定）。
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const found = await loadOrderBacklogReport(params.id);
        if (!found) return notFoundResponse('受注明細書');

        return NextResponse.json(found, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('受注明細書の取得', error);
    }
}

/**
 * PUT /api/order-backlog/reports/[id]
 *
 * 明細ごと全置換で保存する（admin 限定）。行の並び替え・削除・追加が同時に起きるので
 * 差分更新ではなく deleteMany → createMany（同一トランザクション）で入れ替える。
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const existing = await prisma.orderBacklogReport.findUnique({
            where: { id: params.id },
            select: { id: true },
        });
        if (!existing) return notFoundResponse('受注明細書');

        const body = await req.json();
        const parsed = validateRequest(orderBacklogReportSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;

        await prisma.$transaction(async (tx) => {
            await tx.orderBacklogReportLine.deleteMany({ where: { reportId: params.id } });
            if (input.lines.length > 0) {
                await tx.orderBacklogReportLine.createMany({
                    data: input.lines.map((line, index) => ({
                        ...toLineCreateData(line, index),
                        reportId: params.id,
                    })),
                });
            }
            await tx.orderBacklogReport.update({
                where: { id: params.id },
                data: {
                    asOfDate: toAsOfDate(input.asOfDate),
                    title: input.title ?? null,
                    applicantName: input.applicantName ?? null,
                    individualThreshold: input.individualThreshold,
                    unreceivedMode: input.unreceivedMode,
                    taxMode: input.taxMode,
                    notes: input.notes ?? null,
                },
            });
        });

        const saved = await loadOrderBacklogReport(params.id);
        if (!saved) return notFoundResponse('受注明細書');

        return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('受注明細書の保存', error);
    }
}

/**
 * DELETE /api/order-backlog/reports/[id]
 * 明細は FK の ON DELETE CASCADE で一緒に消える（admin 限定）。
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const existing = await prisma.orderBacklogReport.findUnique({
            where: { id: params.id },
            select: { id: true },
        });
        if (!existing) return notFoundResponse('受注明細書');

        await prisma.orderBacklogReport.delete({ where: { id: params.id } });
        return deleteSuccessResponse('受注明細書');
    } catch (error) {
        return serverErrorResponse('受注明細書の削除', error);
    }
}
