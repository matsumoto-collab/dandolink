import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
];
const VALID_CATEGORIES = ['survey', 'assembly', 'demolition', 'other', 'instruction', 'document'] as const;

export type ProjectMasterImageCategory = typeof VALID_CATEGORIES[number];

export interface UploadProjectMasterImageParams {
    projectMasterId: string;
    uploadedBy: string;
    category: ProjectMasterImageCategory;
    file: File;
    description?: string | null;
}

export type UploadProjectMasterImageResult =
    | { ok: true; fileId: string }
    | { ok: false; error: string };

/**
 * 画像ファイルを案件マスターに紐づけて保存する共通処理。
 * - sharpでrotate + 表示用WebP(1920px) + サムネWebP(200px) + オリジナルWebPの3種類を生成
 * - Supabase Storageへアップロード
 * - ProjectMasterFileレコードを作成
 *
 * 既存の /api/project-masters/[id]/files POST と同じアップロード形式を踏襲。
 */
export async function uploadProjectMasterImage(
    params: UploadProjectMasterImageParams
): Promise<UploadProjectMasterImageResult> {
    const { projectMasterId, uploadedBy, category, file, description } = params;

    if (!VALID_CATEGORIES.includes(category)) {
        return { ok: false, error: '不正なカテゴリです' };
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
        return { ok: false, error: '画像ファイルのみアップロード可能です' };
    }
    if (file.size > MAX_FILE_SIZE) {
        return { ok: false, error: 'ファイルサイズが20MBを超えています' };
    }

    const fileId = randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const rotated = sharp(buffer).rotate();
    const rotatedBuffer = await rotated.toBuffer();
    const [origWebp, displayWebp, thumbWebp] = await Promise.all([
        sharp(rotatedBuffer).webp({ quality: 90, effort: 2 }).toBuffer(),
        sharp(rotatedBuffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 2 }).toBuffer(),
        sharp(rotatedBuffer).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 50, effort: 0 }).toBuffer(),
    ]);

    const storagePath = `${projectMasterId}/${fileId}.webp`;
    const thumbnailPath: string = `${projectMasterId}/${fileId}_thumb.webp`;
    let originalStoragePath: string | null = `${projectMasterId}/${fileId}_original.webp`;

    const [origResult, displayResult, thumbResult] = await Promise.all([
        supabaseAdmin.storage.from(STORAGE_BUCKET).upload(originalStoragePath, origWebp, { contentType: 'image/webp', upsert: false }),
        supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
        supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
    ]);

    if (displayResult.error) {
        logger.error('[uploadProjectMasterImage] display upload error', displayResult.error);
        const cleanupPaths = [originalStoragePath, thumbnailPath].filter(Boolean) as string[];
        if (cleanupPaths.length > 0) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(cleanupPaths);
        return { ok: false, error: 'ファイルのアップロードに失敗しました' };
    }

    let finalThumbnailPath: string | null = thumbnailPath;
    if (origResult.error) {
        logger.error('[uploadProjectMasterImage] original upload error', origResult.error);
        originalStoragePath = null;
    }
    if (thumbResult.error) {
        logger.error('[uploadProjectMasterImage] thumbnail upload error', thumbResult.error);
        finalThumbnailPath = null;
    }

    const uploadedAt = new Date();
    const SIGNED_URL_TTL = 3600;
    const expiresAt = new Date(uploadedAt.getTime() + SIGNED_URL_TTL * 1000);

    const urlPaths = [storagePath, finalThumbnailPath, originalStoragePath].filter(Boolean) as string[];
    const urlResults = await Promise.all(
        urlPaths.map(p => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL))
    );
    const urlMap = new Map(urlPaths.map((p, i) => [p, urlResults[i].data?.signedUrl ?? null]));

    const newSignedUrl = urlMap.get(storagePath) ?? null;
    const newExpiresAt = newSignedUrl ? expiresAt : null;
    const thumbSignedUrl = finalThumbnailPath ? urlMap.get(finalThumbnailPath) ?? null : null;
    const thumbExpiresAt = thumbSignedUrl ? expiresAt : null;
    const originalSignedUrl = originalStoragePath ? urlMap.get(originalStoragePath) ?? null : null;
    const originalExpiresAt = originalSignedUrl ? expiresAt : null;

    try {
        await prisma.projectMasterFile.create({
            data: {
                id: fileId,
                projectMasterId,
                fileName: file.name,
                storagePath,
                fileType: 'image',
                mimeType: 'image/webp',
                fileSize: displayWebp.length,
                description: description || null,
                uploadedBy,
                category,
                sourceType: null,
                signedUrl: newSignedUrl,
                signedUrlExpiresAt: newExpiresAt,
                thumbnailPath: finalThumbnailPath,
                thumbnailSignedUrl: thumbSignedUrl,
                thumbnailSignedUrlExpiresAt: thumbExpiresAt,
                originalStoragePath,
                originalSignedUrl,
                originalSignedUrlExpiresAt: originalExpiresAt,
            },
        });
    } catch (e) {
        logger.error('[uploadProjectMasterImage] DB insert failed', e);
        const cleanupPaths = [storagePath, finalThumbnailPath, originalStoragePath].filter(Boolean) as string[];
        if (cleanupPaths.length > 0) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(cleanupPaths);
        return { ok: false, error: 'DB登録に失敗しました' };
    }

    return { ok: true, fileId };
}

export const CATEGORY_LABELS: Record<ProjectMasterImageCategory, string> = {
    survey: '現調写真',
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
    instruction: '指示書/図面',
    document: '書類',
};
