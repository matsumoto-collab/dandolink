import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { parseJsonField } from '@/lib/json-utils';
import { resolveConstructionTypeForFile } from '@/lib/photoConstructionType';

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
    'application/octet-stream', // JWW等のバイナリファイル
];

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        // 案件マスターの存在確認
        const projectMaster = await prisma.projectMaster.findUnique({ where: { id } });
        if (!projectMaster) return notFoundResponse('案件マスター');

        const isAdminOrManager = session!.user.role === 'admin' || session!.user.role === 'manager';

        const files = await prisma.projectMasterFile.findMany({
            where: {
                projectMasterId: id,
                // 書類カテゴリは管理者・マネージャーのみ
                ...(!isAdminOrManager ? { category: { not: 'document' } } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });

        // 保存者名を解決（ProjectMasterFile は User リレーション未設定のため uploadedBy で別引き）
        const uploaderIds = Array.from(
            new Set(files.map((f) => f.uploadedBy).filter((v): v is string => !!v))
        );
        const uploaders = uploaderIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: uploaderIds } },
                select: { id: true, displayName: true },
            })
            : [];
        const uploaderNameById = new Map(uploaders.map((u) => [u.id, u.displayName]));

        // 完了報告写真(assembly/demolition/other)の工事種別を推測。
        // 写真は配置への参照を持たないため uploadedBy×createdAt で配置を照合する。
        const REPORT_CATEGORIES = new Set(['assembly', 'demolition', 'other']);
        const ctNameByFileId = new Map<string, string>();
        if (files.some((f) => REPORT_CATEGORIES.has(f.category) && f.uploadedBy)) {
            const [assignments, constructionTypes] = await Promise.all([
                prisma.projectAssignment.findMany({
                    where: { projectMasterId: id },
                    select: {
                        date: true,
                        assignedEmployeeId: true,
                        confirmedWorkerIds: true,
                        workStartedAt: true,
                        workEndedAt: true,
                        constructionType: true,
                    },
                }),
                prisma.constructionType.findMany({ select: { id: true, name: true } }),
            ]);
            const ctNameById = new Map(constructionTypes.map((c) => [c.id, c.name]));
            const assignmentsForMatch = assignments.map((a) => ({
                date: a.date.toISOString(),
                assignedEmployeeId: a.assignedEmployeeId,
                workerIds: parseJsonField<string[]>(a.confirmedWorkerIds, []),
                workStartedAt: a.workStartedAt ? a.workStartedAt.toISOString() : null,
                workEndedAt: a.workEndedAt ? a.workEndedAt.toISOString() : null,
                constructionType: a.constructionType,
            }));
            for (const f of files) {
                if (!REPORT_CATEGORIES.has(f.category)) continue;
                const name = resolveConstructionTypeForFile(
                    { uploadedBy: f.uploadedBy, createdAt: f.createdAt.toISOString() },
                    assignmentsForMatch,
                    ctNameById,
                );
                if (name) ctNameByFileId.set(f.id, name);
            }
        }

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

                return {
                    ...file,
                    signedUrl,
                    thumbnailSignedUrl,
                    originalSignedUrl,
                    uploadedByName: file.uploadedBy ? uploaderNameById.get(file.uploadedBy) ?? null : null,
                    constructionTypeName: ctNameByFileId.get(file.id) ?? null,
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

        const { id } = await context.params;

        // 案件マスターの存在確認
        const projectMaster = await prisma.projectMaster.findUnique({ where: { id } });
        if (!projectMaster) return notFoundResponse('案件マスター');

        // 権限:
        //  - canDispatch（admin/manager/foreman1）は全カテゴリに直接アップロード可能
        //  - それ以外（foreman2 等）は当該案件で
        //      a) 自分が職長として配置されている、または
        //      b) 確定メンバー（confirmedWorkerIds）に含まれている
        //    場合に許可（報告時の画像添付に対応）
        const userCanDispatch = canDispatch(session!.user);
        if (!userCanDispatch) {
            const candidates = await prisma.projectAssignment.findMany({
                where: { projectMasterId: id },
                select: { id: true, assignedEmployeeId: true, confirmedWorkerIds: true },
            });
            const allowed = candidates.some(
                (a) =>
                    a.assignedEmployeeId === session!.user.id ||
                    parseJsonField<string[]>(a.confirmedWorkerIds, []).includes(session!.user.id)
            );
            if (!allowed) return errorResponse('権限がありません', 403);
        }

        const VALID_CATEGORIES = ['survey', 'assembly', 'demolition', 'other', 'instruction', 'perspective', 'document'];

        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const originalPdf = formData.get('originalPdf') as File | null;
        // DXF由来の3Dパース: file=表示用ペイロード(JSON・lib/dxf3d.tsでクライアント変換), originalDxf=元DXF
        const originalDxf = formData.get('originalDxf') as File | null;
        const description = formData.get('description') as string | null;
        const categoryRaw = formData.get('category') as string | null;
        const category = categoryRaw && VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'other';

        // 書類カテゴリは管理者・マネージャーのみ
        if (category === 'document') {
            const isAdminOrManager = session!.user.role === 'admin' || session!.user.role === 'manager';
            if (!isAdminOrManager) return errorResponse('書類カテゴリへのアップロード権限がありません', 403);
        }

        if (!file) return errorResponse('ファイルが選択されていません', 400);
        const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
        const ALLOWED_EXTENSIONS = ['jww', 'dxf'];
        const isAllowedByExt = ALLOWED_EXTENSIONS.includes(fileExt);
        // 3Dパース取込: originalDxf 付きの JSON ペイロード（fileName は元DXF名のまま）
        const is3dPayload = !!originalDxf && file.type === 'application/json';
        if (!ALLOWED_MIME_TYPES.includes(file.type) && !isAllowedByExt && !is3dPayload) {
            return errorResponse('対応していないファイル形式です（画像・PDF・JWW・DXF）', 400);
        }
        if (file.size > MAX_FILE_SIZE) {
            return errorResponse('ファイルサイズが20MBを超えています', 400);
        }
        if (originalDxf && originalDxf.size > MAX_FILE_SIZE) {
            return errorResponse('DXFファイルサイズが20MBを超えています', 400);
        }

        const fileId = randomUUID();
        const fileType = is3dPayload
            ? '3d'
            : file.type.startsWith('image/')
                ? 'image'
                : (fileExt === 'jww' || fileExt === 'dxf' ? fileExt : 'pdf');
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

        // 元ファイルの種別（PDFから変換された画像 / DXFから変換された3Dペイロード）
        const sourceType = originalPdf ? 'pdf' : is3dPayload ? 'dxf' : null;

        if (fileType === 'image') {
            // 回転済みバッファを1回だけ作成し、各サイズ変換はそこから派生
            const rotated = sharp(buffer).rotate();
            const rotatedBuffer = await rotated.toBuffer();
            const [displayWebp, thumbWebp] = await Promise.all([
                sharp(rotatedBuffer).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 2 }).toBuffer(),
                sharp(rotatedBuffer).resize(200, 200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 50, effort: 0 }).toBuffer(),
            ]);

            uploadBuffer = displayWebp;
            uploadContentType = 'image/webp';
            storagePath = `${id}/${fileId}.webp`;
            actualFileSize = displayWebp.length;
            thumbnailPath = `${id}/${fileId}_thumb.webp`;

            if (originalPdf) {
                // PDF元ファイルを保存
                const pdfBuffer = Buffer.from(await originalPdf.arrayBuffer());
                originalStoragePath = `${id}/${fileId}_original.pdf`;
                const [pdfResult, displayResult, thumbResult] = await Promise.all([
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(originalStoragePath, pdfBuffer, { contentType: 'application/pdf', upsert: false }),
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
                ]);
                if (displayResult.error) {
                    logger.error('Storage upload error:', displayResult.error);
                    const cleanupPaths = [originalStoragePath, thumbnailPath].filter(Boolean) as string[];
                    if (cleanupPaths.length > 0) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(cleanupPaths);
                    return errorResponse('ファイルのアップロードに失敗しました', 500);
                }
                if (pdfResult.error) {
                    logger.error('Original PDF upload error:', pdfResult.error);
                    originalStoragePath = null;
                }
                if (thumbResult.error) {
                    logger.error('Thumbnail upload error:', thumbResult.error);
                    thumbnailPath = null;
                }
            } else {
                // 通常の画像: 表示用 + サムネイルのみ保存
                const [displayResult, thumbResult] = await Promise.all([
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, displayWebp, { contentType: 'image/webp', upsert: false }),
                    supabaseAdmin.storage.from(STORAGE_BUCKET).upload(thumbnailPath, thumbWebp, { contentType: 'image/webp', upsert: false }),
                ]);
                if (displayResult.error) {
                    logger.error('Storage upload error:', displayResult.error);
                    if (thumbnailPath) await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([thumbnailPath]);
                    return errorResponse('ファイルのアップロードに失敗しました', 500);
                }
                if (thumbResult.error) {
                    logger.error('Thumbnail upload error:', thumbResult.error);
                    thumbnailPath = null;
                }
            }
        } else if (is3dPayload) {
            // 3Dパース: 表示用ペイロード(JSON)を storagePath に、元DXFを originalStoragePath に保存
            uploadBuffer = buffer;
            uploadContentType = 'application/json';
            storagePath = `${id}/${fileId}_3d.json`;
            actualFileSize = buffer.length;
            originalStoragePath = `${id}/${fileId}_original.dxf`;

            const dxfBuffer = Buffer.from(await originalDxf!.arrayBuffer());
            const [jsonResult, dxfResult] = await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(storagePath, uploadBuffer, { contentType: uploadContentType, upsert: false }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(originalStoragePath, dxfBuffer, { contentType: 'application/octet-stream', upsert: false }),
            ]);
            if (jsonResult.error) {
                logger.error('Storage upload error:', jsonResult.error);
                await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([originalStoragePath]);
                return errorResponse('ファイルのアップロードに失敗しました', 500);
            }
            if (dxfResult.error) {
                logger.error('Original DXF upload error:', dxfResult.error);
                originalStoragePath = null;
            }
        } else {
            uploadBuffer = buffer;
            uploadContentType = file.type || 'application/octet-stream';
            const ALLOWED_EXTENSIONS = ['pdf', 'jww', 'dxf'];
            const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                return errorResponse('対応していないファイル拡張子です', 400);
            }
            storagePath = `${id}/${fileId}.${ext}`;
            actualFileSize = buffer.length;

            const { error: uploadError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, uploadBuffer, { contentType: uploadContentType, upsert: false });
            if (uploadError) {
                logger.error('Storage upload error:', uploadError);
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
                sourceType,
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
            { ...projectMasterFile, signedUrl: newSignedUrl, thumbnailSignedUrl: thumbSignedUrl, originalSignedUrl, uploadedByName: session!.user.name ?? null },
            { status: 201 }
        );
    } catch (error) {
        return serverErrorResponse('ファイルのアップロード', error);
    }
}
