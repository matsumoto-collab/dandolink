import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

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
                const updateData: Record<string, unknown> = {};

                // オリジナルURL更新
                let signedUrl = file.signedUrl;
                const originalValid = file.signedUrl && file.signedUrlExpiresAt &&
                    file.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
                if (!originalValid) {
                    const { data } = await supabaseAdmin.storage
                        .from(STORAGE_BUCKET)
                        .createSignedUrl(file.storagePath, SIGNED_URL_TTL);
                    signedUrl = data?.signedUrl ?? null;
                    if (signedUrl) {
                        updateData.signedUrl = signedUrl;
                        updateData.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
                    }
                }

                // サムネイルURL更新
                let thumbnailSignedUrl = file.thumbnailSignedUrl;
                if (file.thumbnailPath) {
                    const thumbValid = file.thumbnailSignedUrl && file.thumbnailSignedUrlExpiresAt &&
                        file.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
                    if (!thumbValid) {
                        const { data } = await supabaseAdmin.storage
                            .from(STORAGE_BUCKET)
                            .createSignedUrl(file.thumbnailPath, SIGNED_URL_TTL);
                        thumbnailSignedUrl = data?.signedUrl ?? null;
                        if (thumbnailSignedUrl) {
                            updateData.thumbnailSignedUrl = thumbnailSignedUrl;
                            updateData.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
                        }
                    }
                }

                // 元画像URL更新
                let originalSignedUrl = file.originalSignedUrl;
                if (file.originalStoragePath) {
                    const origValid = file.originalSignedUrl && file.originalSignedUrlExpiresAt &&
                        file.originalSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
                    if (!origValid) {
                        const { data } = await supabaseAdmin.storage
                            .from(STORAGE_BUCKET)
                            .createSignedUrl(file.originalStoragePath, SIGNED_URL_TTL);
                        originalSignedUrl = data?.signedUrl ?? null;
                        if (originalSignedUrl) {
                            updateData.originalSignedUrl = originalSignedUrl;
                            updateData.originalSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
                        }
                    }
                }

                if (Object.keys(updateData).length > 0) {
                    await prisma.projectMasterFile.update({
                        where: { id: file.id },
                        data: updateData,
                    });
                }

                return { ...file, signedUrl, thumbnailSignedUrl, originalSignedUrl };
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

        const fileId = randomUUID();
        const fileType = file.type.startsWith('image/') ? 'image' : 'pdf';
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 画像の場合: オリジナルをWebP変換 + サムネイル生成
        // PDFの場合: そのままアップロード
        let uploadBuffer: Buffer;
        let uploadContentType: string;
        let storagePath: string;
        let thumbnailPath: string | null = null;
        let actualFileSize: number;

        let originalStoragePath: string | null = null;

        if (fileType === 'image') {
            // 3種類のWebP変換を並列処理
            const [origWebp, displayWebp, thumbWebp] = await Promise.all([
                sharp(buffer).rotate().webp({ quality: 92 }).toBuffer(),
                sharp(buffer).rotate().resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
                sharp(buffer).rotate().resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer(),
            ]);

            uploadBuffer = displayWebp;
            uploadContentType = 'image/webp';
            storagePath = `${id}/${fileId}.webp`;
            actualFileSize = displayWebp.length;
            originalStoragePath = `${id}/${fileId}_original.webp`;
            thumbnailPath = `${id}/${fileId}_thumb.webp`;

            // 3ファイルを並列アップロード
            const [origResult, displayResult, thumbResult] = await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(originalStoragePath, origWebp, { contentType: 'image/webp', upsert: false }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
            ]);

            if (displayResult.error) {
                console.error('Storage upload error:', displayResult.error);
                const cleanupPaths = [originalStoragePath, thumbnailPath].filter(Boolean) as string[];
                if (cleanupPaths.length > 0) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(cleanupPaths);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
            if (origResult.error) {
                console.error('Original upload error:', origResult.error);
                originalStoragePath = null;
            }
            if (thumbResult.error) {
                console.error('Thumbnail upload error:', thumbResult.error);
                thumbnailPath = null;
            }
        } else {
            uploadBuffer = buffer;
            uploadContentType = file.type;
            const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
            storagePath = `${id}/${fileId}.${ext}`;
            actualFileSize = buffer.length;

            const { error: uploadError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, uploadBuffer, { contentType: uploadContentType, upsert: false });
            if (uploadError) {
                console.error('Storage upload error:', uploadError);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
        }

        // 署名付きURLを並列生成
        const uploadedAt = new Date();
        const SIGNED_URL_TTL = 3600;
        const expiresAt = new Date(uploadedAt.getTime() + SIGNED_URL_TTL * 1000);

        const urlPaths = [storagePath, thumbnailPath, originalStoragePath].filter(Boolean) as string[];
        const urlResults = await Promise.all(
            urlPaths.map(p => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL))
        );
        const urlMap = new Map(urlPaths.map((p, i) => [p, urlResults[i].data?.signedUrl ?? null]));

        const newSignedUrl = urlMap.get(storagePath) ?? null;
        const newExpiresAt = newSignedUrl ? expiresAt : null;
        const thumbSignedUrl = thumbnailPath ? urlMap.get(thumbnailPath) ?? null : null;
        const thumbExpiresAt = thumbSignedUrl ? expiresAt : null;
        const originalSignedUrl = originalStoragePath ? urlMap.get(originalStoragePath) ?? null : null;
        const originalExpiresAt = originalSignedUrl ? expiresAt : null;

        // DBにメタデータ＋URLキャッシュを保存
        const projectMasterFile = await prisma.projectMasterFile.create({
            data: {
                id: fileId,
                projectMasterId: id,
                fileName: file.name,
                storagePath,
                fileType,
                mimeType: uploadContentType,
                fileSize: actualFileSize,
                description: description || null,
                uploadedBy: session!.user.id,
                category,
                signedUrl: newSignedUrl,
                signedUrlExpiresAt: newExpiresAt,
                thumbnailPath,
                thumbnailSignedUrl: thumbSignedUrl,
                thumbnailSignedUrlExpiresAt: thumbExpiresAt,
                originalStoragePath,
                originalSignedUrl,
                originalSignedUrlExpiresAt: originalExpiresAt,
            },
        });

        return NextResponse.json(
            { ...projectMasterFile, signedUrl: newSignedUrl, thumbnailSignedUrl: thumbSignedUrl, originalSignedUrl },
            { status: 201 }
        );
    } catch (error) {
        return serverErrorResponse('ファイルのアップロード', error);
    }
}
