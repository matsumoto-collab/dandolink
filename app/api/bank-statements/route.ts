import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { SIGNED_URL_TTL } from '@/lib/receipt';
import { TARGET_MONTH_RE, withFreshBankStatementSignedUrls } from '@/lib/bankStatement';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
// 画像以外（PDF・CSV）は下の isPdf / isCsv で判定する
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

// 銀行入金明細の一覧。?month=YYYY-MM で対象年月を絞り込む（省略時は全件）。
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const month = new URL(req.url).searchParams.get('month');
        if (month && !TARGET_MONTH_RE.test(month)) return errorResponse('対象年月が不正です', 400);
        const where: Prisma.BankStatementWhereInput = month ? { targetMonth: month } : {};

        // 新しい月から順に並べ、同じ月の中は取り込んだ順（新しい順）
        const statements = await prisma.bankStatement.findMany({
            where,
            orderBy: [{ targetMonth: 'desc' }, { createdAt: 'desc' }],
        });

        const refreshed = await Promise.all(statements.map((s) => withFreshBankStatementSignedUrls(s)));
        return NextResponse.json(refreshed, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('銀行入金明細一覧の取得', error);
    }
}

// 銀行入金明細のファイル（画像/PDF/CSV）をアップロードして保管する。
// AI読み取りはせず、対象年月とメモを添えて保存するだけ（app/api/card-receipts/route.ts の縮小版）。
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canAccessCashbook(session!.user)) return errorResponse('権限がありません', 403);

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const targetMonth = formData.get('targetMonth')?.toString().trim() || '';
        const memo = formData.get('memo')?.toString().trim() || null;
        if (!file) return errorResponse('ファイルが選択されていません', 400);
        if (!TARGET_MONTH_RE.test(targetMonth)) return errorResponse('対象年月が不正です', 400);

        // CSV はブラウザによって MIME が application/vnd.ms-excel や空になるため拡張子でも判定する
        const isCsv = file.type === 'text/csv' || /\.csv$/i.test(file.name);
        const isImage = ALLOWED_IMAGE_MIME_TYPES.includes(file.type);
        const isPdf = file.type === 'application/pdf';
        if (!isCsv && !isImage && !isPdf) return errorResponse('対応していないファイル形式です（画像・PDF・CSV）', 400);
        if (file.size > MAX_FILE_SIZE) return errorResponse('ファイルサイズが20MBを超えています', 400);

        const id = randomUUID();
        const buffer = Buffer.from(await file.arrayBuffer());

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
            storagePath = `bank-statements/${id}.webp`;
            thumbnailPath = `bank-statements/${id}_thumb.webp`;
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
            // PDF・CSV は無加工でそのまま保管する
            storagePath = isCsv ? `bank-statements/${id}.csv` : `bank-statements/${id}.pdf`;
            mimeType = isCsv ? 'text/csv' : 'application/pdf';
            fileSize = buffer.length;

            const up = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
            if (up.error) {
                logger.error('Storage upload error:', up.error);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
        }

        // 署名付きURLは作成時に発行してDBへキャッシュする（一覧では期限切れ分だけ再発行）
        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000);
        const paths = [storagePath, thumbnailPath].filter(Boolean) as string[];
        const signed = await Promise.all(paths.map((p) => supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, SIGNED_URL_TTL)));
        const signedMap = new Map(paths.map((p, i) => [p, signed[i].data?.signedUrl ?? null]));

        const created = await prisma.bankStatement.create({
            data: {
                id,
                targetMonth,
                memo,
                fileName: file.name,
                storagePath,
                thumbnailPath,
                mimeType,
                fileSize,
                signedUrl: signedMap.get(storagePath) ?? null,
                signedUrlExpiresAt: expiresAt,
                thumbnailSignedUrl: thumbnailPath ? signedMap.get(thumbnailPath) ?? null : null,
                thumbnailSignedUrlExpiresAt: thumbnailPath ? expiresAt : null,
                uploadedBy: session!.user.id,
            },
        });

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('銀行入金明細の取り込み', error);
    }
}
