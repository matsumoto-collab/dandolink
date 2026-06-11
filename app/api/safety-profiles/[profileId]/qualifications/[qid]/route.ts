import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    notFoundResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

interface RouteContext { params: Promise<{ profileId: string; qid: string }>; }

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId, qid } = await context.params;
        // profileId 一致を条件に含め、別プロフィールの資格を消せないようにする
        const qualification = await prisma.workerQualification.findFirst({
            where: { id: qid, profileId },
            select: { id: true, imagePath: true, imageThumbPath: true },
        });
        if (!qualification) return notFoundResponse('資格');

        await prisma.workerQualification.delete({ where: { id: qid } });

        // 資格証画像も Storage から削除（失敗してもレコード削除は成立させる）
        const paths = [qualification.imagePath, qualification.imageThumbPath].filter(Boolean) as string[];
        if (paths.length > 0) {
            const { error: removeError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
            if (removeError) logger.error('資格証画像の削除に失敗:', removeError);
        }

        return deleteSuccessResponse('資格');
    } catch (error) {
        return serverErrorResponse('資格削除', error);
    }
}
