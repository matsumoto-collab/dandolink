import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    notFoundResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';

interface RouteContext { params: Promise<{ profileId: string; qid: string }>; }

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId, qid } = await context.params;
        // profileId 一致を条件に含め、別プロフィールの資格を消せないようにする
        const result = await prisma.workerQualification.deleteMany({
            where: { id: qid, profileId },
        });
        if (result.count === 0) return notFoundResponse('資格');

        return deleteSuccessResponse('資格');
    } catch (error) {
        return serverErrorResponse('資格削除', error);
    }
}
