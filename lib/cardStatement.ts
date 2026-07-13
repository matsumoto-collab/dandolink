import { prisma } from '@/lib/prisma';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { SIGNED_URL_TTL } from '@/lib/receipt';

// 今日（JST）の日付を UTC 0時の Date に。締め日や利用日を読み取れなかった場合の既定値に使う
// （app/api/cashbook/upload/route.ts の todayJst と同ロジック）。
export const todayJst = (): Date => {
    const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); // YYYY-MM-DD
    return new Date(`${ymd}T00:00:00.000Z`);
};

// レシート受け箱の取得時に常に同梱するリレーション（紐付け状態は statementLine の有無で導出）
export const CARD_RECEIPT_INCLUDE = {
    expenseCategory: true,
    statementLine: {
        include: {
            statement: { select: { id: true, cardLabel: true, closingDate: true } },
        },
    },
} as const;

// 明細書詳細の行に常に同梱するリレーション
export const CARD_STATEMENT_LINE_INCLUDE = {
    expenseCategory: true,
    cardReceipt: { include: { expenseCategory: true } },
} as const;

interface SignableFile {
    id: string;
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

// 署名付きURLが残り5分未満なら再生成してDBにキャッシュし、最新URLを載せて返す。
// lib/receipt.ts withFreshSignedUrls と同ロジックの CardReceipt / CardStatement 版（保存先モデルだけ差し替え）。
// SupplierInvoice（lib/supplierInvoice.ts）も persist 差し替えで共用するため export している。
export async function withFreshFileSignedUrls<T extends SignableFile>(
    entity: T,
    persist: (id: string, data: Record<string, unknown>) => Promise<unknown>
): Promise<T> {
    const now = new Date();
    const BUFFER_MS = 5 * 60 * 1000;
    const updateData: Record<string, unknown> = {};

    let signedUrl = entity.signedUrl;
    const valid = entity.signedUrl && entity.signedUrlExpiresAt && entity.signedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
    if (!valid) {
        const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(entity.storagePath, SIGNED_URL_TTL);
        signedUrl = data?.signedUrl ?? null;
        if (signedUrl) {
            updateData.signedUrl = signedUrl;
            updateData.signedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
        }
    }

    let thumbnailSignedUrl = entity.thumbnailSignedUrl;
    if (entity.thumbnailPath) {
        const tvalid =
            entity.thumbnailSignedUrl &&
            entity.thumbnailSignedUrlExpiresAt &&
            entity.thumbnailSignedUrlExpiresAt.getTime() - now.getTime() > BUFFER_MS;
        if (!tvalid) {
            const { data } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(entity.thumbnailPath, SIGNED_URL_TTL);
            thumbnailSignedUrl = data?.signedUrl ?? null;
            if (thumbnailSignedUrl) {
                updateData.thumbnailSignedUrl = thumbnailSignedUrl;
                updateData.thumbnailSignedUrlExpiresAt = new Date(now.getTime() + SIGNED_URL_TTL * 1000);
            }
        }
    }

    if (Object.keys(updateData).length > 0) {
        await persist(entity.id, updateData);
    }
    return { ...entity, signedUrl, thumbnailSignedUrl };
}

export function withFreshCardReceiptSignedUrls<T extends SignableFile>(receipt: T): Promise<T> {
    return withFreshFileSignedUrls(receipt, (id, data) => prisma.cardReceipt.update({ where: { id }, data }));
}

export function withFreshCardStatementSignedUrls<T extends SignableFile>(statement: T): Promise<T> {
    return withFreshFileSignedUrls(statement, (id, data) => prisma.cardStatement.update({ where: { id }, data }));
}
