import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { joyoStatementSaveSchema, joyoStatementsQuerySchema } from '@/lib/validations/joyoStatement';
import {
    JoyoRejectError,
    buildStatementWriteData,
    loadJoyoIssuer,
    loadJoyoSettings,
    loadJoyoStatementRows,
    prepareStatementItems,
    todayJstYmd,
} from '@/lib/joyoStatementServer';
import type { JoyoStatementsResponse } from '@/types/joyoStatement';
import { okResponse, requireJoyoAdmin } from './_shared';

export const dynamic = 'force-dynamic';

const ISSUED_MESSAGE = '発行済みの明細は変更できません。先に発行を取り消してください';

/**
 * GET /api/joyo-statements?year=2026&month=9
 * 対象月の一覧（対象者ごとに 今の出勤簿・保存済みの明細・支払予定）を返す（admin 限定）。
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireJoyoAdmin();
        if (error) return error;

        const sp = req.nextUrl.searchParams;
        const parsed = validateRequest(joyoStatementsQuerySchema, {
            year: sp.get('year') ?? '',
            month: sp.get('month') ?? '',
        });
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const { year, month } = parsed.data;

        const today = todayJstYmd();
        const [settings, issuer, rows] = await Promise.all([
            loadJoyoSettings(),
            loadJoyoIssuer(),
            loadJoyoStatementRows(year, month, today),
        ]);

        const body: JoyoStatementsResponse = { year, month, today, settings, issuer, rows };
        return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('支払明細書の一覧取得', error);
    }
}

/**
 * PUT /api/joyo-statements
 * 下書きを保存する（その対象者・月の明細が無ければ作る・あれば上書き）。発行済みは断る（admin 限定）。
 */
export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(joyoStatementSaveSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;

        const contractor = await prisma.joyoContractor.findUnique({
            where: { id: input.contractorId },
            select: { id: true },
        });
        if (!contractor) return notFoundResponse('対象者');

        const prepared = prepareStatementItems(input.items);
        if (!prepared.ok) return errorResponse(prepared.message, 400);

        const key = { contractorId: input.contractorId, year: input.year, month: input.month };
        const data = buildStatementWriteData(input, prepared, session?.user?.id ?? null);

        // 「無ければ作る・あれば上書き」。発行済みの中身を上書きしないよう、上書きは status='draft' のときだけ
        // （確かめてから書くまでのあいだに別タブで発行された場合も、updateMany の条件で弾く）
        const savedId = await prisma.$transaction(async (tx) => {
            const existing = await tx.joyoStatement.findUnique({
                where: { contractorId_year_month: key },
                select: { id: true, status: true },
            });
            if (!existing) {
                const created = await tx.joyoStatement.create({
                    data: { ...key, status: 'draft', ...data },
                    select: { id: true },
                });
                return created.id;
            }
            if (existing.status === 'issued') throw new JoyoRejectError(ISSUED_MESSAGE);
            const updated = await tx.joyoStatement.updateMany({
                where: { id: existing.id, status: 'draft' },
                data,
            });
            if (updated.count !== 1) throw new JoyoRejectError(ISSUED_MESSAGE);
            return existing.id;
        });

        return okResponse(savedId);
    } catch (error) {
        if (error instanceof JoyoRejectError) return errorResponse(error.message, 400);
        return serverErrorResponse('支払明細書の保存', error);
    }
}
