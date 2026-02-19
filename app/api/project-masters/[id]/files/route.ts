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

        // 署名付きURLをキャッシュ利用（有効期限5分超ならDB値を再利用）
        const now = new Date();
        const BUFFER_MS = 5 * 60 * 1000;
        const SIGNED_URL_TTL = 3600; // 1時間

        const filesWithUrls = await Promise.all(
            files.map(async (file) => {
                // キャッシュが有効な場合はそのまま返す
                if (
                    file.signedUrl &&
                    file.signedUrlExpiresAt &&
                    file.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS
                ) {
                    return { ...file };
                }

                // 期限切れ or 未生成 → Supabase で再生成してDBを更新
                const { data } = await supabaseAdmin.storage
                    .from(STORAGE_BUCKET)
                    .createSignedUrl(file.storagePath, SIGNED_URL_TTL);

                const newSignedUrl = data?.signedUrl ?? null;
                const newExpiresAt = newSignedUrl
                    ? new Date(now.getTime() + SIGNED_URL_TTL * 1000)
                    : null;

                if (newSignedUrl) {
                    await prisma.projectMasterFile.update({
                        where: { id: file.id },
                        data: { signedUrl: newSignedUrl, signedUrlExpiresAt: newExpiresAt },
                    });
                }

                return { ...file, signedUrl: newSignedUrl };
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

        const VALID_CATEGORIES = ['survey', 'assembly', 'demolition', 'other', 'instruction'];

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const description = formData.get('description') as string | null;
        const categoryRaw = formData.get('category') as string | null;
        const category = categoryRaw && VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'other';

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

        // 署名付きURLを生成（DBにもキャッシュ保存）
        const uploadedAt = new Date();
        const SIGNED_URL_TTL = 3600;
        const { data: signedData } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(storagePath, SIGNED_URL_TTL);

        const newSignedUrl = signedData?.signedUrl ?? null;
        const newExpiresAt = newSignedUrl
            ? new Date(uploadedAt.getTime() + SIGNED_URL_TTL * 1000)
            : null;

        // DBにメタデータ＋URLキャッシュを保存
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
                category,
                signedUrl: newSignedUrl,
                signedUrlExpiresAt: newExpiresAt,
            },
        });

        return NextResponse.json(
            { ...projectMasterFile, signedUrl: newSignedUrl },
            { status: 201 }
        );
    } catch (error) {
        return serverErrorResponse('ファイルのアップロード', error);
    }
}
