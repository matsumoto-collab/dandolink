import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations';
import { orderBacklogReportSchema } from '@/lib/validations/orderBacklog';
import { toLineInput, toReportRecord } from '@/lib/orderBacklog/server';
import type { OrderBacklogReportSummary } from '@/types/orderBacklog';
import { requireOrderBacklogAdmin, toAsOfDate, toLineCreateData } from '../_shared';

/**
 * GET /api/order-backlog/reports
 * 保存済みの受注明細書を新しい基準日順に返す（admin 限定）。
 */
export async function GET() {
    try {
        const { error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const rows = await prisma.orderBacklogReport.findMany({
            orderBy: [{ asOfDate: 'desc' }, { updatedAt: 'desc' }],
            select: {
                id: true,
                asOfDate: true,
                title: true,
                createdByName: true,
                updatedAt: true,
                lines: { select: { contractAmount: true, excluded: true } },
            },
        });

        const summaries: OrderBacklogReportSummary[] = rows.map((row) => {
            const active = row.lines.filter((l) => !l.excluded);
            return {
                id: row.id,
                asOfDate: row.asOfDate.toISOString().slice(0, 10),
                title: row.title,
                lineCount: active.length,
                contractTotal: active.reduce((s, l) => s + l.contractAmount, 0),
                createdByName: row.createdByName,
                updatedAt: row.updatedAt.toISOString(),
            };
        });

        return NextResponse.json(summaries, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('受注明細書の一覧取得', error);
    }
}

/**
 * POST /api/order-backlog/reports
 * 受注明細書を明細ごと新規作成する（admin 限定）。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const body = await req.json();
        const parsed = validateRequest(orderBacklogReportSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;

        const created = await prisma.orderBacklogReport.create({
            data: {
                asOfDate: toAsOfDate(input.asOfDate),
                title: input.title ?? null,
                applicantName: input.applicantName ?? null,
                individualThreshold: input.individualThreshold,
                unreceivedMode: input.unreceivedMode,
                taxMode: input.taxMode,
                notes: input.notes ?? null,
                createdById: session?.user?.id ?? null,
                createdByName: session?.user?.name ?? null,
                lines: { create: input.lines.map(toLineCreateData) },
            },
            include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        });

        return NextResponse.json(
            { report: toReportRecord(created), lines: created.lines.map(toLineInput) },
            { status: 201, headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('受注明細書の作成', error);
    }
}
