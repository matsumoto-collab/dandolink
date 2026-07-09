import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseReceiptDate } from '@/lib/receipt';
import { CARD_STATEMENT_LINE_INCLUDE, withFreshCardReceiptSignedUrls, withFreshCardStatementSignedUrls } from '@/lib/cardStatement';

interface RouteContext { params: Promise<{ id: string }>; }

const amt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

// 明細書詳細（全行 + 照合済みレシート同梱）
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const statement = await prisma.cardStatement.findUnique({
            where: { id },
            include: { lines: { orderBy: { sortOrder: 'asc' }, include: CARD_STATEMENT_LINE_INCLUDE } },
        });
        if (!statement) return notFoundResponse('明細書');

        // 明細書本体＋照合済みレシートの署名URLを必要に応じて再生成
        const fresh = await withFreshCardStatementSignedUrls(statement);
        const lines = await Promise.all(
            fresh.lines.map(async (l) => (l.cardReceipt ? { ...l, cardReceipt: await withFreshCardReceiptSignedUrls(l.cardReceipt) } : l)),
        );

        return NextResponse.json({ ...fresh, lines }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('明細書の取得', error);
    }
}

// ヘッダ情報（カード名・会員名・下4桁・締め日・合計）の手修正
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.cardStatement.findUnique({ where: { id } });
        if (!current) return notFoundResponse('明細書');

        const data: Record<string, unknown> = {};
        if ('cardLabel' in body) {
            const label = body.cardLabel?.toString().trim();
            if (!label) return errorResponse('カード名を入力してください', 400);
            data.cardLabel = label;
        }
        if ('memberName' in body) data.memberName = body.memberName?.toString().trim() || null;
        if ('cardLast4' in body) data.cardLast4 = body.cardLast4?.toString().trim() || null;
        if ('closingDate' in body) data.closingDate = parseReceiptDate(body.closingDate);
        if ('totalAmount' in body) data.totalAmount = amt(body.totalAmount);

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.cardStatement.update({
            where: { id },
            data,
            include: { lines: { orderBy: { sortOrder: 'asc' }, include: CARD_STATEMENT_LINE_INCLUDE } },
        });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('明細書の更新', error);
    }
}

// 明細書の削除。行は Cascade で消え、紐付いていたレシートは自動的に未紐付けへ戻る（受け箱には残る）。
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const statement = await prisma.cardStatement.findUnique({ where: { id } });
        if (!statement) return notFoundResponse('明細書');

        const paths = [statement.storagePath, statement.thumbnailPath].filter(Boolean) as string[];
        if (paths.length > 0) {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            if (rmErr) logger.error('Storage remove error:', rmErr);
        }
        await prisma.cardStatement.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('明細書の削除', error);
    }
}
