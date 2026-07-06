import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { SIGNED_URL_TTL } from '@/lib/receipt';

// 現金出納帳の取得時に常に同梱するリレーション
export const CASHBOOK_INCLUDE = {
    expenseCategory: true,
};

// 入金/出金の区分は UI と共用のため types/cashbook.ts に定義（ここからも参照できるよう再エクスポート）
export { CASHBOOK_ENTRY_TYPES } from '@/types/cashbook';
export type { CashbookEntryType } from '@/types/cashbook';

interface SignableCashbookEntry {
    id: string;
    storagePath: string | null;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

// 署名付きURLが残り5分未満なら再生成してDBにキャッシュし、最新URLを載せて返す。
// lib/receipt.ts withFreshSignedUrls の CashbookEntry 版（証憑なしの手打ち行はそのまま返す）。
export async function withFreshCashbookSignedUrls<T extends SignableCashbookEntry>(entry: T): Promise<T> {
    if (!entry.storagePath) return entry;

    const now = new Date();
    const BUFFER_MS = 5 * 60 * 1000;
    const updateData: Record<string, unknown> = {};

    let signedUrl = entry.signedUrl;
    const valid = entry.signedUrl && entry.signedUrlExpiresAt && entry.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
    if (!valid) {
        const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(entry.storagePath, SIGNED_URL_TTL);
        signedUrl = data?.signedUrl ?? null;
        if (signedUrl) {
            updateData.signedUrl = signedUrl;
            updateData.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
        }
    }

    let thumbnailSignedUrl = entry.thumbnailSignedUrl;
    if (entry.thumbnailPath) {
        const tvalid =
            entry.thumbnailSignedUrl && entry.thumbnailSignedUrlExpiresAt && entry.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
        if (!tvalid) {
            const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(entry.thumbnailPath, SIGNED_URL_TTL);
            thumbnailSignedUrl = data?.signedUrl ?? null;
            if (thumbnailSignedUrl) {
                updateData.thumbnailSignedUrl = thumbnailSignedUrl;
                updateData.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
            }
        }
    }

    if (Object.keys(updateData).length > 0) {
        await prisma.cashbookEntry.update({ where: { id: entry.id }, data: updateData });
    }
    return { ...entry, signedUrl, thumbnailSignedUrl };
}
