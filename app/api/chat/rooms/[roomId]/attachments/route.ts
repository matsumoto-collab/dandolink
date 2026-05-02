import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
];
const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];
const SIGNED_URL_TTL = 3600; // 1時間

/**
 * POST /api/chat/rooms/[roomId]/attachments
 *
 * チャット添付ファイルをStorageへアップロードし、署名付きURL付きで返す。
 * DBレコード（MessageAttachment）はメッセージ送信時に作成するため、
 * このエンドポイントはメタデータだけを返す。
 *
 * 戻り値: {
 *   fileType, storagePath, thumbnailPath?, signedUrl, thumbnailSignedUrl?,
 *   mimeType, fileSize, width?, height?
 * }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const { roomId } = await params;
        const userId = session!.user.id;

        const member = await prisma.chatMember.findUnique({
            where: { roomId_userId: { roomId, userId } },
        });
        if (!member || member.leftAt) return errorResponse('権限がありません', 403);

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) return errorResponse('ファイルが選択されていません', 400);
        if (file.size > MAX_FILE_SIZE) {
            return errorResponse('ファイルサイズが20MBを超えています', 400);
        }

        const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
        const isPdf = ALLOWED_DOCUMENT_TYPES.includes(file.type);
        if (!isImage && !isPdf) {
            return errorResponse('対応していないファイル形式です（画像・PDF）', 400);
        }

        const attachmentId = randomUUID();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileType: 'image' | 'pdf' = isImage ? 'image' : 'pdf';

        let storagePath: string;
        let thumbnailPath: string | null = null;
        let uploadBuffer: Buffer = buffer;
        let uploadContentType = file.type || 'application/octet-stream';
        let actualFileSize = buffer.length;
        let width: number | null = null;
        let height: number | null = null;

        if (isImage) {
            const rotated = sharp(buffer).rotate();
            const meta = await rotated.metadata();
            width = meta.width ?? null;
            height = meta.height ?? null;
            const rotatedBuffer = await rotated.toBuffer();
            const [displayWebp, thumbWebp] = await Promise.all([
                sharp(rotatedBuffer)
                    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 78, effort: 2 })
                    .toBuffer(),
                sharp(rotatedBuffer)
                    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 60, effort: 0 })
                    .toBuffer(),
            ]);
            uploadBuffer = displayWebp;
            uploadContentType = 'image/webp';
            actualFileSize = displayWebp.length;
            storagePath = `chat/${roomId}/${attachmentId}.webp`;
            thumbnailPath = `chat/${roomId}/${attachmentId}_thumb.webp`;

            const [displayResult, thumbResult] = await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, {
                    contentType: 'image/webp', upsert: false,
                }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, {
                    contentType: 'image/webp', upsert: false,
                }),
            ]);
            if (displayResult.error) {
                logger.error('[chat attach] display upload', displayResult.error);
                if (thumbnailPath) {
                    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([thumbnailPath]).catch(() => { /* noop */ });
                }
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
            if (thumbResult.error) {
                logger.error('[chat attach] thumbnail upload', thumbResult.error);
                thumbnailPath = null;
            }
        } else {
            // PDF
            storagePath = `chat/${roomId}/${attachmentId}.pdf`;
            const { error: uploadError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, uploadBuffer, { contentType: uploadContentType, upsert: false });
            if (uploadError) {
                logger.error('[chat attach] pdf upload', uploadError);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
        }

        // 署名付きURL
        const [{ data: mainSigned }, thumbSignedRes] = await Promise.all([
            supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL),
            thumbnailPath
                ? supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(thumbnailPath, SIGNED_URL_TTL)
                : Promise.resolve({ data: null as { signedUrl?: string } | null }),
        ]);
        const signedUrl = mainSigned?.signedUrl ?? null;
        const thumbnailSignedUrl = thumbSignedRes && 'data' in thumbSignedRes
            ? thumbSignedRes.data?.signedUrl ?? null
            : null;
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);

        return NextResponse.json({
            fileType,
            storagePath,
            thumbnailPath,
            signedUrl,
            signedUrlExpiresAt: expiresAt.toISOString(),
            thumbnailSignedUrl,
            thumbnailSignedUrlExpiresAt: thumbnailPath ? expiresAt.toISOString() : null,
            mimeType: uploadContentType,
            fileSize: actualFileSize,
            originalFileName: file.name,
            width,
            height,
        });
    } catch (error) {
        return serverErrorResponse('添付アップロード', error);
    }
}
