import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { TARGET_MONTH_RE, withFreshBankStatementSignedUrls } from '@/lib/bankStatement';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const current = await prisma.bankStatement.findUnique({ where: { id } });
        if (!current) return notFoundResponse('銀行入金明細');

        const data: Record<string, unknown> = {};
        if ('memo' in body) data.memo = body.memo?.toString().trim() || null;
        // 対象年月（'YYYY-MM'）。取り違えた月から移動できるようインライン編集で変更可
        if ('targetMonth' in body) {
            const v = body.targetMonth?.toString().trim() || '';
            if (!TARGET_MONTH_RE.test(v)) return errorResponse('対象年月が不正です', 400);
            data.targetMonth = v;
        }

        if (Object.keys(data).length === 0) return errorResponse('更新対象が指定されていません', 400);

        const updated = await prisma.bankStatement.update({ where: { id }, data });
        return NextResponse.json(await withFreshBankStatementSignedUrls(updated));
    } catch (error) {
        return serverErrorResponse('銀行入金明細の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const statement = await prisma.bankStatement.findUnique({ where: { id } });
        if (!statement) return notFoundResponse('銀行入金明細');

        // 1レコード1ファイル（他行との共有はない）のでそのまま Storage から削除する
        const paths = [statement.storagePath, statement.thumbnailPath].filter(Boolean) as string[];
        if (paths.length > 0) {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            if (rmErr) logger.error('Storage remove error:', rmErr);
        }
        await prisma.bankStatement.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('銀行入金明細の削除', error);
    }
}
