import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    errorResponse,
    notFoundResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * 資格証画像のアップロード（差し替え）・削除。
 * 既存のファイル基盤（project-master-files バケット・プライベート＋署名URL・sharp で
 * WebP 変換＋サムネ生成）に準拠。パスは qualifications/{profileId}/ 配下で分離する。
 */

interface RouteContext { params: Promise<{ profileId: string; qid: string }>; }

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const SIGNED_URL_TTL = 3600;

export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId, qid } = await context.params;
        const qualification = await prisma.workerQualification.findFirst({
            where: { id: qid, profileId },
            select: { id: true, imagePath: true, imageThumbPath: true },
        });
        if (!qualification) return notFoundResponse('資格');

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) return errorResponse('ファイルが選択されていません', 400);
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return errorResponse('対応していないファイル形式です（画像のみ）', 400);
        }
        if (file.size > MAX_FILE_SIZE) {
            return errorResponse('ファイルサイズが20MBを超えています', 400);
        }

        // WebP変換＋サムネ生成（既存ファイル基盤と同じ処理）
        const buffer = Buffer.from(await file.arrayBuffer());
        const rotatedBuffer = await sharp(buffer).rotate().toBuffer();
        const [displayWebp, thumbWebp] = await Promise.all([
            sharp(rotatedBuffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 2 }).toBuffer(),
            sharp(rotatedBuffer).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 50, effort: 0 }).toBuffer(),
        ]);

        const fileId = randomUUID();
        const imagePath = `qualifications/${profileId}/${fileId}.webp`;
        const imageThumbPath = `qualifications/${profileId}/${fileId}_thumb.webp`;

        const [displayResult, thumbResult] = await Promise.all([
            supabaseAdmin.storage.from(STORAGE_BUCKET).upload(imagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
            supabaseAdmin.storage.from(STORAGE_BUCKET).upload(imageThumbPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
        ]);
        if (displayResult.error) {
            logger.error('資格証画像のアップロードに失敗:', displayResult.error);
            await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([imageThumbPath]).catch(() => undefined);
            return errorResponse('画像のアップロードに失敗しました', 500);
        }
        const thumbOk = !thumbResult.error;
        if (!thumbOk) logger.error('資格証サムネイルのアップロードに失敗:', thumbResult.error);

        // 旧画像のパスを差し替えてから Storage の旧ファイルを削除（差し替え運用）
        const oldPaths = [qualification.imagePath, qualification.imageThumbPath].filter(Boolean) as string[];
        const updated = await prisma.workerQualification.update({
            where: { id: qid },
            data: { imagePath, imageThumbPath: thumbOk ? imageThumbPath : null },
        });
        if (oldPaths.length > 0) {
            const { error: removeError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(oldPaths);
            if (removeError) logger.error('旧資格証画像の削除に失敗:', removeError);
        }

        // 署名URLを添えて返す（フロントは即時表示に使う）
        const [imageUrlRes, thumbUrlRes] = await Promise.all([
            supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(imagePath, SIGNED_URL_TTL),
            thumbOk
                ? supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(imageThumbPath, SIGNED_URL_TTL)
                : Promise.resolve({ data: null }),
        ]);

        return NextResponse.json(
            {
                ...updated,
                imageUrl: imageUrlRes.data?.signedUrl ?? null,
                imageThumbUrl: thumbUrlRes.data?.signedUrl ?? null,
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('資格証画像アップロード', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { profileId, qid } = await context.params;
        const qualification = await prisma.workerQualification.findFirst({
            where: { id: qid, profileId },
            select: { id: true, imagePath: true, imageThumbPath: true },
        });
        if (!qualification) return notFoundResponse('資格');
        if (!qualification.imagePath && !qualification.imageThumbPath) {
            return notFoundResponse('資格証画像');
        }

        await prisma.workerQualification.update({
            where: { id: qid },
            data: { imagePath: null, imageThumbPath: null },
        });

        const paths = [qualification.imagePath, qualification.imageThumbPath].filter(Boolean) as string[];
        const { error: removeError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(paths);
        if (removeError) logger.error('資格証画像の削除に失敗:', removeError);

        return deleteSuccessResponse('資格証画像');
    } catch (error) {
        return serverErrorResponse('資格証画像削除', error);
    }
}
