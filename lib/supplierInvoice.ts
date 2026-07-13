import type { Prisma, Payee } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withFreshFileSignedUrls } from '@/lib/cardStatement';

// 受け箱の取得時に常に同梱するリレーション（照合状態・口座不一致警告の表示に payee を使う）
export const SUPPLIER_INVOICE_INCLUDE = {
    payee: true,
} as const;

interface SignableSupplierInvoice {
    id: string;
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

// 署名付きURLの再生成（lib/cardStatement.ts の共通実装に保存先モデルだけ差し替え）
export function withFreshSupplierInvoiceSignedUrls<T extends SignableSupplierInvoice>(invoice: T): Promise<T> {
    return withFreshFileSignedUrls(invoice, (id, data) => prisma.supplierInvoice.update({ where: { id }, data }));
}

// $transaction 内でも通常クライアントでも使えるように最小限のメソッドだけ要求する
type PayeeFinder = Pick<Prisma.TransactionClient, 'payee'>;

/**
 * 請求書の抽出値から振込先マスター(Payee)を照合する（自動確定は完全一致のみ）。
 * 旧・仕入請求書取込の確定ルートと同じ3段フォールバック:
 *   ① 既存紐付け(payeeId) ② 口座番号の完全一致 ③ 支払先名の完全一致（略称も含む）
 * あいまい一致はここでは扱わない（誤紐付け防止。候補提示はUI側の検索で行う）。
 */
export async function findMatchingPayee(
    db: PayeeFinder,
    inv: { payeeId?: string | null; accountNumber?: string | null; payeeName?: string | null },
): Promise<Payee | null> {
    if (inv.payeeId) {
        const byId = await db.payee.findUnique({ where: { id: inv.payeeId } });
        if (byId) return byId;
    }
    if (inv.accountNumber) {
        const byAccount = await db.payee.findFirst({ where: { isActive: true, accountNumber: inv.accountNumber } });
        if (byAccount) return byAccount;
    }
    if (inv.payeeName) {
        const byName = await db.payee.findFirst({
            where: { isActive: true, OR: [{ name: inv.payeeName }, { alias: inv.payeeName }] },
        });
        if (byName) return byName;
    }
    return null;
}
