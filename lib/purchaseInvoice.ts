import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';

export const SIGNED_URL_TTL = 3600; // 1時間

// 仕入請求書の取得時に常に同梱するリレーション
export const INVOICE_INCLUDE = {
    items: { orderBy: { sortOrder: 'asc' as const } },
    expenseCategory: true,
    projectMaster: true,
    payee: true,
};

// 'YYYY-MM-DD' を UTC 0時の Date に。不正・空は null。
export const parseInvoiceDate = (s: string | null | undefined): Date | null => {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    const d = new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
};

interface SignableInvoice {
    id: string;
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

// 署名付きURLが残り5分未満なら再生成してDBにキャッシュし、最新URLを載せて返す。
export async function withFreshSignedUrls<T extends SignableInvoice>(inv: T): Promise<T> {
    const now = new Date();
    const BUFFER_MS = 5 * 60 * 1000;
    const updateData: Record<string, unknown> = {};

    let signedUrl = inv.signedUrl;
    const valid = inv.signedUrl && inv.signedUrlExpiresAt && inv.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
    if (!valid) {
        const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(inv.storagePath, SIGNED_URL_TTL);
        signedUrl = data?.signedUrl ?? null;
        if (signedUrl) {
            updateData.signedUrl = signedUrl;
            updateData.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
        }
    }

    let thumbnailSignedUrl = inv.thumbnailSignedUrl;
    if (inv.thumbnailPath) {
        const tvalid = inv.thumbnailSignedUrl && inv.thumbnailSignedUrlExpiresAt && inv.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
        if (!tvalid) {
            const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(inv.thumbnailPath, SIGNED_URL_TTL);
            thumbnailSignedUrl = data?.signedUrl ?? null;
            if (thumbnailSignedUrl) {
                updateData.thumbnailSignedUrl = thumbnailSignedUrl;
                updateData.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
            }
        }
    }

    if (Object.keys(updateData).length > 0) {
        await prisma.purchaseInvoice.update({ where: { id: inv.id }, data: updateData });
    }
    return { ...inv, signedUrl, thumbnailSignedUrl };
}
