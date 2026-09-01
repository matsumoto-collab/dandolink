import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { canEditEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ fileId: string }>; }

/** 添付ファイルを1件削除する（Storage の実体も消す）。 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { fileId } = await context.params;
        const file = await prisma.equipmentMaintenanceFile.findUnique({ where: { id: fileId } });
        if (!file) return notFoundResponse('添付ファイル');

        const paths = [file.storagePath, file.thumbnailPath].filter(Boolean) as string[];
        const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
        // 実体が消せなくても行は消す（残骸はストレージ側の掃除で対応する）
        if (rmErr) logger.error('Equipment file remove error:', rmErr);

        await prisma.equipmentMaintenanceFile.delete({ where: { id: fileId } });
        return deleteSuccessResponse('添付ファイル');
    } catch (error) {
        return serverErrorResponse('添付ファイルの削除', error);
    }
}
