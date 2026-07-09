import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { parseReceiptDate } from '@/lib/receipt';
import { CARD_STATEMENT_LINE_INCLUDE } from '@/lib/cardStatement';

interface RouteContext { params: Promise<{ id: string }>; }

// 符号を保持する金額パーサ（返金行のマイナスを許容）
const signedAmt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s円¥]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
};

// 明細行の更新を1本の PATCH で扱う:
// ① レシート紐付け { cardReceiptId: 'xxx' } → status='matched' + 行の費目が未設定ならレシートの費目を引き継ぐ
// ② 紐付け解除 { cardReceiptId: null } → status='unmatched' に戻す
// ③ ステータス変更 { status: 'no_receipt' | 'unmatched' }（照合済みからの直接変更は不可・先に解除）
// ④ 値の手修正（useDate / storeName / amount / 費目 / メモ 等）
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.cardStatementLine.findUnique({ where: { id } });
        if (!current) return notFoundResponse('明細行');

        // ①② 紐付け・解除（他のフィールドと同時指定はしない前提の専用パス）
        if ('cardReceiptId' in body) {
            if (body.cardReceiptId) {
                const receiptId = String(body.cardReceiptId);
                const receipt = await prisma.cardReceipt.findUnique({ where: { id: receiptId } });
                if (!receipt) return notFoundResponse('レシート');
                try {
                    const updated = await prisma.cardStatementLine.update({
                        where: { id },
                        data: {
                            cardReceiptId: receiptId,
                            status: 'matched',
                            matchedAt: new Date(),
                            matchedBy: session!.user.id,
                            // 行に費目が未設定ならレシート側のAI費目候補を引き継ぐ
                            ...(current.expenseCategoryId == null && receipt.expenseCategoryId
                                ? { expenseCategoryId: receipt.expenseCategoryId }
                                : {}),
                        },
                        include: CARD_STATEMENT_LINE_INCLUDE,
                    });
                    return NextResponse.json(updated);
                } catch (e) {
                    // cardReceiptId は @unique（並行タップ等での二重紐付けは DB が防ぐ）
                    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                        return errorResponse('このレシートは他の明細行に紐付け済みです', 400);
                    }
                    throw e;
                }
            }
            const unlinked = await prisma.cardStatementLine.update({
                where: { id },
                data: { cardReceiptId: null, status: 'unmatched', matchedAt: null, matchedBy: null },
                include: CARD_STATEMENT_LINE_INCLUDE,
            });
            return NextResponse.json(unlinked);
        }

        const data: Record<string, unknown> = {};

        // ③ ステータス変更
        if ('status' in body) {
            const s = String(body.status);
            if (s !== 'no_receipt' && s !== 'unmatched') return errorResponse('このステータスへは変更できません', 400);
            if (current.cardReceiptId) return errorResponse('照合済みの行は先に紐付けを解除してください', 400);
            data.status = s;
        }

        // ④ 値の手修正
        if ('useDate' in body) {
            const d = parseReceiptDate(body.useDate);
            if (!d) return errorResponse('利用日が不正です', 400);
            data.useDate = d;
        }
        if ('storeName' in body) {
            const name = body.storeName?.toString().trim();
            if (!name) return errorResponse('店名を入力してください', 400);
            data.storeName = name;
        }
        if ('storeCategory' in body) data.storeCategory = body.storeCategory?.toString().trim() || null;
        if ('amount' in body) {
            const n = signedAmt(body.amount);
            if (n == null) return errorResponse('金額が不正です', 400);
            data.amount = n;
        }
        if ('expenseCategoryId' in body) data.expenseCategoryId = body.expenseCategoryId || null;
        if ('itemDetails' in body) data.itemDetails = body.itemDetails?.toString().trim() || null;
        if ('notes' in body) data.notes = body.notes?.toString().trim() || null;

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.cardStatementLine.update({ where: { id }, data, include: CARD_STATEMENT_LINE_INCLUDE });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('明細行の更新', error);
    }
}

// 明細行の削除（誤抽出行の除去）。紐付いていたレシートは自動的に未紐付けへ戻る。
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const line = await prisma.cardStatementLine.findUnique({ where: { id } });
        if (!line) return notFoundResponse('明細行');

        await prisma.cardStatementLine.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('明細行の削除', error);
    }
}
