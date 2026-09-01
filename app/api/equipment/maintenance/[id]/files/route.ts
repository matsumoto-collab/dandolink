import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { SIGNED_URL_TTL } from '@/lib/receipt';
import { canEditEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_REQUEST = 10;
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
];

/**
 * 整備・修理履歴に見積書・請求書の写真（またはPDF）を添付する。
 * 画像は向きを直して webp に変換し、表示用とサムネイルの2枚を保存する
 * （レシート受け箱 app/api/card-receipts/route.ts と同じ持ち方）。
 */
export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const record = await prisma.equipmentMaintenanceRecord.findUnique({ where: { id }, select: { id: true } });
        if (!record) return notFoundResponse('整備・修理履歴');

        const formData = await request.formData();
        const files = formData.getAll('files').filter((f): f is File => f instanceof File);
        if (files.length === 0) return errorResponse('ファイルが選択されていません', 400);
        if (files.length > MAX_FILES_PER_REQUEST) return errorResponse('一度に添付できるのは10件までです', 400);
        for (const f of files) {
            if (!ALLOWED_MIME_TYPES.includes(f.type)) return errorResponse('対応していないファイル形式です（画像・PDF）', 400);
            if (f.size > MAX_FILE_SIZE) return errorResponse('ファイルサイズが20MBを超えています', 400);
        }

        const created = [];
        for (const file of files) {
            const fileId = randomUUID();
            const buffer = Buffer.from(await file.arrayBuffer());
            const isImage = file.type.startsWith('image/');

            let storagePath: string;
            let thumbnailPath: string | null = null;
            let mimeType: string;
            let fileSize: number;

            if (isImage) {
                const rotated = await sharp(buffer).rotate().toBuffer();
                const [displayWebp, thumbWebp] = await Promise.all([
                    sharp(rotated).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 2 }).toBuffer(),
                    sharp(rotated).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 50, effort: 0 }).toBuffer(),
                ]);
                storagePath = 'equipment-maintenance/' + fileId + '.webp';
                thumbnailPath = 'equipment-maintenance/' + fileId + '_thumb.webp';
                mimeType = 'image/webp';
                fileSize = displayWebp.length;

                const [up1, up2] = await Promise.all([
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
                ]);
                if (up1.error) {
                    logger.error('Storage upload error:', up1.error);
                    if (thumbnailPath) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([thumbnailPath]);
                    return errorResponse('ファイルのアップロードに失敗しました', 500);
                }
                if (up2.error) {
                    logger.error('Thumbnail upload error:', up2.error);
                    thumbnailPath = null;
                }
            } else {
                storagePath = 'equipment-maintenance/' + fileId + '.pdf';
                mimeType = 'application/pdf';
                fileSize = buffer.length;
                const up = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
                if (up.error) {
                    logger.error('Storage upload error:', up.error);
                    return errorResponse('ファイルのアップロードに失敗しました', 500);
                }
            }

            const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
            const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
            const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
            const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

            const row = await prisma.equipmentMaintenanceFile.create({
                data: {
                    id: fileId,
                    recordId: id,
                    fileName: file.name,
                    storagePath,
                    thumbnailPath,
                    mimeType,
                    fileSize,
                    signedUrl: signedMap.get(storagePath) ?? null,
                    signedUrlExpiresAt: expiresAt,
                    thumbnailSignedUrl: thumbnailPath ? signedMap.get(thumbnailPath) ?? null : null,
                    thumbnailSignedUrlExpiresAt: thumbnailPath ? expiresAt : null,
                    uploadedById: session!.user.id,
                },
            });
            created.push(row);
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('写真の添付', error);
    }
}
