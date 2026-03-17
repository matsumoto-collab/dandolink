import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';

interface RouteContext {
    params: Promise<{ id: string; fileId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id, fileId } = await context.params;
        const quality = req.nextUrl.searchParams.get('quality') || 'display';

        const file = await prisma.projectMasterFile.findFirst({
            where: { id: fileId, projectMasterId: id },
        });
        if (!file) return notFoundResponse('ファイル');

        // 元画像 or 表示用のパスを選択
        const path = quality === 'original' && file.originalStoragePath
            ? file.originalStoragePath
            : file.storagePath;

        const { data } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(path, 60, { download: file.fileName });

        if (!data?.signedUrl) {
            return errorResponse('ダウンロードURLの生成に失敗しました', 500);
        }

        return NextResponse.redirect(data.signedUrl);
    } catch (error) {
        return serverErrorResponse('ファイルのダウンロード', error);
    }
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

        // Supabase Storage から削除（表示用 + サムネイル + 元画像）
        const pathsToRemove = [file.storagePath];
        if (file.thumbnailPath) pathsToRemove.push(file.thumbnailPath);
        if (file.originalStoragePath) pathsToRemove.push(file.originalStoragePath);
        const { error: removeError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .remove(pathsToRemove);

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
