import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { parseReceiptDate, RECEIPT_INCLUDE, withFreshSignedUrls } from '@/lib/receipt';
import { PAYMENT_METHODS } from '@/types/receipt';

interface RouteContext { params: Promise<{ id: string }>; }

// 仕分け値のフィールドキー（status を除く）。編集は pending の時のみ許可する。
const FIELD_KEYS = ['storeName', 'issueDate', 'totalAmount', 'taxAmount', 'expenseCategoryId', 'projectMasterId', 'paymentMethod', 'paidBy', 'notes'];

const amt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const receipt = await prisma.receipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
        if (!receipt) return notFoundResponse('領収書');

        const fresh = await withFreshSignedUrls(receipt);
        return NextResponse.json(fresh, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('領収書の取得', error);
    }
}

// 保存（下書き編集）・確定・再オープンを1本の PATCH で扱う。
// 領収書の確定は副作用（支払予定・原価計上）がないため /confirm サブルートは設けない。
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.receipt.findUnique({ where: { id } });
        if (!current) return notFoundResponse('領収書');

        const hasFieldEdits = FIELD_KEYS.some((k) => k in body);
        // 確定済みはフィールド編集不可（再オープンしてから編集する）
        if (hasFieldEdits && current.status !== 'pending') {
            return errorResponse('仕分け済みの領収書は編集できません。再オープンしてください', 400);
        }

        const data: Record<string, unknown> = {};
        if ('storeName' in body) data.storeName = body.storeName?.toString().trim() || null;
        if ('issueDate' in body) data.issueDate = parseReceiptDate(body.issueDate);
        if ('totalAmount' in body) data.totalAmount = amt(body.totalAmount);
        if ('taxAmount' in body) data.taxAmount = amt(body.taxAmount);
        if ('expenseCategoryId' in body) data.expenseCategoryId = body.expenseCategoryId || null;
        if ('projectMasterId' in body) data.projectMasterId = body.projectMasterId || null;
        if ('paymentMethod' in body) {
            const pm = body.paymentMethod?.toString() || null;
            if (pm !== null && !PAYMENT_METHODS.includes(pm)) return errorResponse('支払方法の値が不正です', 400);
            data.paymentMethod = pm;
        }
        if ('paidBy' in body) data.paidBy = body.paidBy?.toString().trim() || null;
        if ('notes' in body) data.notes = body.notes?.toString().trim() || null;

        // 精算フラグは仕分け（費目編集）とは独立。確定済みでも切り替え可能。
        // 精算日(settledAt)は任意指定（'YYYY-MM-DD'）。未指定なら今日（ボタンを押した日）。
        if ('settled' in body) {
            const s = !!body.settled;
            data.settled = s;
            data.settledAt = s ? (parseReceiptDate(body.settledAt) ?? new Date()) : null;
            data.settledBy = s ? session!.user.id : null;
        } else if ('settledAt' in body) {
            // 精算済みのまま精算日だけ修正する（settled は変更しない）
            const d = parseReceiptDate(body.settledAt);
            if (d && current.settled) {
                data.settledAt = d;
                if (!current.settledBy) data.settledBy = session!.user.id;
            }
        }

        if ('status' in body) {
            if (body.status === 'confirmed') {
                // マージ後の値で確定ゲートを検証（body 指定があればそれ、無ければ現在値）
                const effIssueDate = 'issueDate' in body ? (data.issueDate as Date | null) : current.issueDate;
                const effTotal = 'totalAmount' in body ? (data.totalAmount as number | null) : current.totalAmount;
                const effCategory = 'expenseCategoryId' in body ? (data.expenseCategoryId as string | null) : current.expenseCategoryId;
                if (!effIssueDate || !(Number(effTotal) > 0) || !effCategory) {
                    return errorResponse('日付・金額・費目を入力してから確定してください', 400);
                }
                data.status = 'confirmed';
                data.confirmedAt = new Date();
                data.confirmedBy = session!.user.id;
            } else if (body.status === 'pending') {
                // 再オープン（確定の取り消し）
                data.status = 'pending';
                data.confirmedAt = null;
                data.confirmedBy = null;
            } else {
                return errorResponse('このステータスへは変更できません', 400);
            }
        }

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.receipt.update({ where: { id }, data, include: RECEIPT_INCLUDE });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('領収書の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const receipt = await prisma.receipt.findUnique({ where: { id } });
        if (!receipt) return notFoundResponse('領収書');

        // 同じ画像を共有する他の領収書（1枚の写真から分割した複数件）が無い場合のみ Storage から削除する。
        const sharing = await prisma.receipt.count({ where: { storagePath: receipt.storagePath, id: { not: id } } });
        if (sharing === 0) {
            const paths = [receipt.storagePath, receipt.thumbnailPath].filter(Boolean) as string[];
            if (paths.length > 0) {
                const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
                if (rmErr) logger.error('Storage remove error:', rmErr);
            }
        }
        await prisma.receipt.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('領収書の削除', error);
    }
}
