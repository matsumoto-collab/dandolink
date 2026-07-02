import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';

export const SIGNED_URL_TTL = 3600; // 1時間

// 領収書の取得時に常に同梱するリレーション
export const RECEIPT_INCLUDE = {
    expenseCategory: true,
    projectMaster: true,
};

// 'YYYY-MM-DD' を UTC 0時の Date に。不正・空は null。
export const parseReceiptDate = (s: string | null | undefined): Date | null => {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
};

interface SignableReceipt {
    id: string;
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

// 署名付きURLが残り5分未満なら再生成してDBにキャッシュし、最新URLを載せて返す。
export async function withFreshSignedUrls<T extends SignableReceipt>(receipt: T): Promise<T> {
    const now = new Date();
    const BUFFER_MS = 5 * 60 * 1000;
    const updateData: Record<string, unknown> = {};

    let signedUrl = receipt.signedUrl;
    const valid = receipt.signedUrl && receipt.signedUrlExpiresAt && receipt.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
    if (!valid) {
        const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(receipt.storagePath, SIGNED_URL_TTL);
        signedUrl = data?.signedUrl ?? null;
        if (signedUrl) {
            updateData.signedUrl = signedUrl;
            updateData.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
        }
    }

    let thumbnailSignedUrl = receipt.thumbnailSignedUrl;
    if (receipt.thumbnailPath) {
        const tvalid =
            receipt.thumbnailSignedUrl && receipt.thumbnailSignedUrlExpiresAt && receipt.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
        if (!tvalid) {
            const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(receipt.thumbnailPath, SIGNED_URL_TTL);
            thumbnailSignedUrl = data?.signedUrl ?? null;
            if (thumbnailSignedUrl) {
                updateData.thumbnailSignedUrl = thumbnailSignedUrl;
                updateData.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
            }
        }
    }

    if (Object.keys(updateData).length > 0) {
        await prisma.receipt.update({ where: { id: receipt.id }, data: updateData });
    }
    return { ...receipt, signedUrl, thumbnailSignedUrl };
}
