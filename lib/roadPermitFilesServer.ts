/**
 * 道路申請の「許可書（スキャン）」をサーバーで付ける・消す・開く（docs/指示書_道路申請_許可書を見ての修正.md §4）。
 *
 * - 置き場所は今の銀行明細・カード明細と同じ非公開の Storage（STORAGE_BUCKET）。新しい bucket は作らない。
 *   パスは road-permits/<申請の id>/<ファイルの id>.<拡張子>。
 * - 記録は RoadPermit.documents（Json）の様式ごとの permitFiles。ここだけが書く（PUT は画面から来た値を捨てる）。
 * - 申請を消したとき（論理削除）は Storage のファイルは消さない（戻せるように）。
 */
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { normalizeRoadPermitDocuments } from '@/lib/roadPermit/defaults';
import { ROAD_PERMIT_FILE_PATH_PREFIX, permitFileExtension } from '@/lib/roadPermit/permitFiles';
import { ROAD_PERMIT_ROW_INCLUDE, type RoadPermitRow } from '@/lib/roadPermitServer';
import type { RoadPermitDocuments, RoadPermitFormId, RoadPermitPermitFile } from '@/types/roadPermit';

/** 署名付き URL の有効時間（10 分。開くたびに作るので短くてよい） */
export const ROAD_PERMIT_FILE_SIGNED_URL_TTL = 600;

/** 申請を読む（無い・消してある → null） */
async function loadLivePermit(permitId: string) {
    const row = await prisma.roadPermit.findUnique({
        where: { id: permitId },
        select: { id: true, deletedAt: true, documents: true },
    });
    if (!row || row.deletedAt !== null) return null;
    return row;
}

/** documents の中からファイルを探す */
function findPermitFile(documents: RoadPermitDocuments, fileId: string): RoadPermitPermitFile | null {
    for (const f of documents.forms) {
        const hit = f.permitFiles.find((p) => p.id === fileId);
        if (hit) return hit;
    }
    return null;
}

export interface AddRoadPermitFileInput {
    permitId: string;
    formId: RoadPermitFormId;
    file: { name: string; type: string; size: number; buffer: Buffer };
    user: { id: string; name: string };
}

/**
 * 許可書を 1 つ付ける。
 * 戻り値: 更新後の行（ルートが toRoadPermitDto）／null＝申請が無い・消してある／'invalid'＝種類が違う・様式が無い
 */
export async function addRoadPermitFile(input: AddRoadPermitFileInput): Promise<RoadPermitRow | null | 'invalid'> {
    const { permitId, formId, file, user } = input;
    const ext = permitFileExtension(file.type);
    if (!ext) return 'invalid';

    const row = await loadLivePermit(permitId);
    if (!row) return null;

    const documents = normalizeRoadPermitDocuments(row.documents);
    const entry = documents.forms.find((f) => f.formId === formId);
    if (!entry) return 'invalid';

    const fileId = randomUUID();
    const storagePath = `${ROAD_PERMIT_FILE_PATH_PREFIX}${permitId}/${fileId}.${ext}`;
    const up = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file.buffer, { contentType: file.type, upsert: false });
    if (up.error) {
        logger.error('[道路申請] 許可書の upload に失敗:', up.error);
        throw new Error('許可書をStorageに保存できませんでした');
    }

    entry.permitFiles = [
        ...entry.permitFiles,
        {
            id: fileId,
            fileName: file.name || `許可書.${ext}`,
            storagePath,
            mimeType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            uploadedBy: user.id,
            uploadedByName: user.name,
        },
    ];

    try {
        return await prisma.roadPermit.update({
            where: { id: permitId },
            data: { documents: documents as unknown as Prisma.InputJsonValue, updatedBy: user.id },
            include: ROAD_PERMIT_ROW_INCLUDE,
        });
    } catch (error) {
        // 記録できなかったので、置いたファイルを片づける（片づけの失敗はログだけ）
        try {
            const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
            if (rmErr) logger.error('[道路申請] 許可書の片づけ（remove）に失敗:', rmErr);
        } catch (rmError) {
            logger.error('[道路申請] 許可書の片づけ（remove）に失敗:', rmError);
        }
        throw error;
    }
}

/**
 * 許可書を 1 つ消す（Storage と記録の両方）。
 * Storage の削除に失敗しても記録は消す（ログに残す）。
 * 戻り値: 更新後の行／null＝申請が無い・消してある／'not-found'＝そのファイルが無い
 */
export async function removeRoadPermitFile(input: {
    permitId: string;
    fileId: string;
    userId: string;
}): Promise<RoadPermitRow | null | 'not-found'> {
    const { permitId, fileId, userId } = input;
    const row = await loadLivePermit(permitId);
    if (!row) return null;

    const documents = normalizeRoadPermitDocuments(row.documents);
    const target = findPermitFile(documents, fileId);
    if (!target) return 'not-found';

    try {
        const { error: rmErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([target.storagePath]);
        if (rmErr) logger.error('[道路申請] 許可書の remove に失敗（記録は消す）:', rmErr);
    } catch (rmError) {
        logger.error('[道路申請] 許可書の remove に失敗（記録は消す）:', rmError);
    }

    for (const f of documents.forms) {
        f.permitFiles = f.permitFiles.filter((p) => p.id !== fileId);
    }

    return prisma.roadPermit.update({
        where: { id: permitId },
        data: { documents: documents as unknown as Prisma.InputJsonValue, updatedBy: userId },
        include: ROAD_PERMIT_ROW_INCLUDE,
    });
}

/**
 * 許可書を開くための署名付き URL（10 分）。
 * 戻り値: URL／null＝申請が無い・消してある・ファイルが無い
 */
export async function roadPermitFileSignedUrl(input: { permitId: string; fileId: string }): Promise<string | null> {
    const row = await loadLivePermit(input.permitId);
    if (!row) return null;
    const target = findPermitFile(normalizeRoadPermitDocuments(row.documents), input.fileId);
    if (!target) return null;

    const { data, error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(target.storagePath, ROAD_PERMIT_FILE_SIGNED_URL_TTL);
    if (error || !data?.signedUrl) {
        logger.error('[道路申請] 許可書の署名付き URL を作れませんでした:', error);
        throw new Error('許可書の署名付きURLを作れませんでした');
    }
    return data.signedUrl;
}
