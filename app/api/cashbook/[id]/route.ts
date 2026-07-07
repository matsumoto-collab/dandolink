import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseReceiptDate } from '@/lib/receipt';
import { CASHBOOK_INCLUDE, CASHBOOK_ENTRY_TYPES } from '@/lib/cashbook';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.cashbookEntry.findUnique({ where: { id } });
        if (!current) return notFoundResponse('出納帳の行');

        const data: Record<string, unknown> = {};
        if ('date' in body) {
            const d = parseReceiptDate(body.date);
            if (!d) return errorResponse('日付が不正です', 400);
            data.date = d;
        }
        // 反対側の金額セルに入力したとき、行の向き（入金⇄出金）ごと移せるよう entryType も編集可
        if ('entryType' in body) {
            if (!CASHBOOK_ENTRY_TYPES.includes(body.entryType)) return errorResponse('入金/出金の区分が不正です', 400);
            data.entryType = body.entryType;
        }
        if ('description' in body) data.description = body.description?.toString().trim() || null;
        if ('amount' in body) {
            const n = Number(body.amount);
            if (!Number.isFinite(n) || n < 0) return errorResponse('金額が不正です', 400);
            data.amount = n;
        }
        if ('expenseCategoryId' in body) data.expenseCategoryId = body.expenseCategoryId || null;
        // 清算日は null でクリア可能（未精算に戻す）。値があれば YYYY-MM-DD として検証
        if ('settledAt' in body) {
            if (body.settledAt == null || body.settledAt === '') {
                data.settledAt = null;
            } else {
                const d = parseReceiptDate(body.settledAt);
                if (!d) return errorResponse('清算日が不正です', 400);
                data.settledAt = d;
            }
        }
        if ('applicantName' in body) data.applicantName = body.applicantName?.toString().trim() || null;
        // 手動並び順（上下移動）。null でリセット（seq 順に戻る）
        if ('sortOrder' in body) {
            if (body.sortOrder == null) {
                data.sortOrder = null;
            } else {
                const n = Number(body.sortOrder);
                if (!Number.isFinite(n)) return errorResponse('並び順の値が不正です', 400);
                data.sortOrder = n;
            }
        }

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.cashbookEntry.update({ where: { id }, data, include: CASHBOOK_INCLUDE });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('出納帳の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const entry = await prisma.cashbookEntry.findUnique({ where: { id } });
        if (!entry) return notFoundResponse('出納帳の行');

        // 同じ画像を共有する他の行（1枚の写真から分割した複数行）が無い場合のみ Storage から削除する。
        if (entry.storagePath) {
            const sharing = await prisma.cashbookEntry.count({ where: { storagePath: entry.storagePath, id: { not: id } } });
            if (sharing === 0) {
                const paths = [entry.storagePath, entry.thumbnailPath].filter(Boolean) as string[];
                if (paths.length > 0) {
                    const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
                    if (rmErr) logger.error('Storage remove error:', rmErr);
                }
            }
        }
        await prisma.cashbookEntry.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('出納帳の削除', error);
    }
}
