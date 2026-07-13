// 口座番号の照合ユーティリティ（純関数・クライアント/サーバー共用）。
// 受け箱の「口座変更検知」警告と、支払予定への追加モーダルで使う。

// 口座番号の比較用正規化（全半角・ハイフン・空白のゆれを吸収して数字だけにする）
export const normalizeAccountDigits = (v: string | null | undefined): string =>
    (v ?? '').normalize('NFKC').replace(/\D/g, '');

/**
 * 口座変更検知: マスターと請求書の両方に口座番号があり、数字が一致しない場合に true。
 * 請求書の振込先口座差し替え（詐欺・口座変更の見落とし）への警告に使う。
 */
export function hasAccountMismatch(
    payee: { accountNumber?: string | null } | null | undefined,
    inv: { accountNumber: string | null },
): boolean {
    const master = normalizeAccountDigits(payee?.accountNumber);
    const invoice = normalizeAccountDigits(inv.accountNumber);
    return master !== '' && invoice !== '' && master !== invoice;
}
