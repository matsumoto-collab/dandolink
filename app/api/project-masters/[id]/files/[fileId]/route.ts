import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';

interface RouteContext {
    params: Promise<{ id: string; fileId: string }>;
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id, fileId } = await context.params;

        // ファイルの存在確認（案件IDも照合）
        const file = await prisma.projectMasterFile.findFirst({
            where: { id: fileId, projectMasterId: id },
        });
        if (!file) return notFoundResponse('ファイル');

        // Supabase Storage から削除
        const { error: removeError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .remove([file.storagePath]);

        if (removeError) {
            console.error('Storage remove error:', removeError);
            // Storage削除が失敗してもDBレコードは削除する（孤立ファイルのリスクより整合性を優先）
        }

        // DBからメタデータを削除
        await prisma.projectMasterFile.delete({ where: { id: fileId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('ファイルの削除', error);
    }
}
