import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { canEditEquipment, isMaintenanceCategory } from '@/lib/equipment';
import { withFreshEquipmentFileSignedUrls, MAINTENANCE_FILE_ORDER } from '@/lib/equipmentServer';

interface RouteContext { params: Promise<{ id: string }>; }

const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toAmount = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const toInt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

/** 履歴の修正。送られてきた項目だけを更新する。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.equipmentMaintenanceRecord.findUnique({ where: { id } });
        if (!current) return notFoundResponse('整備・修理履歴');

        const body = await request.json().catch(() => ({}));
        const data: Record<string, unknown> = {};

        if ('date' in body) {
            const d = toDate(body.date);
            if (!d) return errorResponse('日付を入力してください', 400);
            data.date = d;
        }
        if ('title' in body) {
            const t = str(body.title, 200);
            if (!t) return errorResponse('内容を入力してください', 400);
            data.title = t;
        }
        if ('category' in body && isMaintenanceCategory(body.category)) data.category = body.category;
        if ('vendor' in body) data.vendor = str(body.vendor);
        if ('amount' in body) data.amount = toAmount(body.amount);
        if ('odometer' in body) data.odometer = toInt(body.odometer);
        if ('nextDueDate' in body) data.nextDueDate = toDate(body.nextDueDate);
        if ('note' in body) data.note = str(body.note, 2000);

        const updated = await prisma.equipmentMaintenanceRecord.update({
            where: { id },
            data,
            include: { files: { orderBy: MAINTENANCE_FILE_ORDER } },
        });
        const files = await Promise.all(updated.files.map((f) => withFreshEquipmentFileSignedUrls(f)));
        return NextResponse.json({ ...updated, amount: updated.amount == null ? null : Number(updated.amount), files });
    } catch (error) {
        return serverErrorResponse('整備・修理履歴の更新', error);
    }
}

/** 履歴の削除。添付ファイルは Storage の実体ごと消す（DBの行は FK の CASCADE で消える）。 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.equipmentMaintenanceRecord.findUnique({
            where: { id },
            include: { files: true },
        });
        if (!current) return notFoundResponse('整備・修理履歴');

        const paths = current.files.flatMap((f) => [f.storagePath, f.thumbnailPath].filter(Boolean) as string[]);
        if (paths.length > 0) {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            // 実体が消せなくても履歴は消す（残骸はストレージ側の掃除で対応する）
            if (rmErr) logger.error('Equipment file remove error:', rmErr);
        }

        await prisma.equipmentMaintenanceRecord.delete({ where: { id } });
        return deleteSuccessResponse('整備・修理履歴');
    } catch (error) {
        return serverErrorResponse('整備・修理履歴の削除', error);
    }
}
