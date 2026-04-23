import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import {
    uploadProjectMasterImage,
    type ProjectMasterImageCategory,
} from '@/lib/projectMasterImageUpload';

interface RouteContext {
    params: Promise<{ id: string }>;
}

const IMAGE_CATEGORIES: ProjectMasterImageCategory[] = ['assembly', 'demolition', 'other'];

/**
 * POST /api/assignments/[id]/images
 * multipart/form-data:
 *   - file: 画像ファイル（1枚）
 *   - category: 'assembly' | 'demolition' | 'other'
 *
 * 配置の担当職長本人、admin、manager のみ実行可能。
 * 画像は該当案件マスターの ProjectMasterFile として保存される。
 *
 * work-statusと分離してあるのは、Vercelのペイロード上限（4.5MB）やタイムアウト（10-60s）
 * 対策として1枚ずつ並列アップロードするため。
 */
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            select: { projectMasterId: true, assignedEmployeeId: true },
        });
        if (!assignment) return notFoundResponse('配置');

        const role = session!.user.role;
        const isOwner = session!.user.id === assignment.assignedEmployeeId;
        const isManager = role === 'admin' || role === 'manager';
        if (!isOwner && !isManager) {
            return errorResponse('この案件に画像をアップロードする権限がありません', 403);
        }

        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File) || file.size === 0) {
            return validationErrorResponse('ファイルが選択されていません');
        }

        const rawCategory = form.get('category');
        if (typeof rawCategory !== 'string' || !IMAGE_CATEGORIES.includes(rawCategory as ProjectMasterImageCategory)) {
            return validationErrorResponse('カテゴリ（assembly/demolition/other）を指定してください');
        }
        const category = rawCategory as ProjectMasterImageCategory;

        const result = await uploadProjectMasterImage({
            projectMasterId: assignment.projectMasterId,
            uploadedBy: session!.user.id,
            category,
            file,
        });

        if (!result.ok) {
            return errorResponse(result.error, 400);
        }

        return NextResponse.json({ fileId: result.fileId, category }, { status: 201 });
    } catch (error) {
        return serverErrorResponse('画像のアップロード', error);
    }
}
