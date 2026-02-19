import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';

interface RouteContext {
    params: Promise<{ id: string }>;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
];

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        // 案件マスターの存在確認
        const projectMaster = await prisma.projectMaster.findUnique({ where: { id } });
        if (!projectMaster) return notFoundResponse('案件マスター');

        const files = await prisma.projectMasterFile.findMany({
            where: { projectMasterId: id },
            orderBy: { createdAt: 'desc' },
        });

        // 署名付きURLを生成（1時間有効）
        const filesWithUrls = await Promise.all(
            files.map(async (file) => {
                const { data } = await supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .createSignedUrl(file.storagePath, 3600);
                return {
                    ...file,
                    signedUrl: data?.signedUrl ?? null,
                };
            })
        );

        return NextResponse.json(filesWithUrls);
    } catch (error) {
        return serverErrorResponse('ファイル一覧の取得', error);
    }
}

export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;

        // 案件マスターの存在確認
        const projectMaster = await prisma.projectMaster.findUnique({ where: { id } });
        if (!projectMaster) return notFoundResponse('案件マスター');

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const description = formData.get('description') as string | null;

        if (!file) return errorResponse('ファイルが選択されていません', 400);
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return errorResponse('対応していないファイル形式です（画像またはPDFのみ）', 400);
        }
        if (file.size > MAX_FILE_SIZE) {
            return errorResponse('ファイルサイズが20MBを超えています', 400);
        }

        // ファイル名をサニタイズ
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9._\-\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '_');
        const fileId = randomUUID();
        const storagePath = `${id}/${fileId}_${sanitizedName}`;
        const fileType = file.type.startsWith('image/') ? 'image' : 'pdf';

        // Supabase Storage へアップロード
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { error: uploadError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, buffer, {
                contentType: file.type,
                upsert: false,
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return errorResponse('ファイルのアップロードに失敗しました', 500);
        }

        // DBにメタデータを保存
        const projectMasterFile = await prisma.projectMasterFile.create({
            data: {
                id: fileId,
                projectMasterId: id,
                fileName: file.name,
                storagePath,
                fileType,
                mimeType: file.type,
                fileSize: file.size,
                description: description || null,
                uploadedBy: session!.user.id,
            },
        });

        // 署名付きURLを生成
        const { data: signedData } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(storagePath, 3600);

        return NextResponse.json(
            { ...projectMasterFile, signedUrl: signedData?.signedUrl ?? null },
            { status: 201 }
        );
    } catch (error) {
        return serverErrorResponse('ファイルのアップロード', error);
    }
}
