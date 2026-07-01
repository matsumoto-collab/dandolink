/**
 * 請求書の入金サマリ計算（パターンA：利益計算には影響させない「未収金の見える化」レイヤー）。
 *
 * 残額 = Invoice.total − Σ amount − Σ fee
 *   - amount = 実際に入金された額
 *   - fee    = 振込手数料の当社負担分（相殺して残額に充当）
 *
 * サーバー（API集計）とクライアント（一覧/詳細表示）の両方から使う純関数。
 */

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

/** 入金記録1件（API レスポンス／クライアント共通の形） */
export interface InvoicePaymentRecord {
    id: string;
    invoiceId: string;
    paidDate: string;   // ISO 文字列
    amount: number;     // 入金額
    fee: number;        // 手数料（当社負担・相殺分）
    method: string | null;
    note: string | null;
    createdAt: string;  // ISO 文字列
    createdBy: string | null;
}

export interface PaymentSummary {
    paidAmount: number;     // Σ amount（実入金の合計）
    feeAmount: number;      // Σ fee（手数料相殺の合計）
    settledAmount: number;  // paidAmount + feeAmount（充当済み合計）
    remaining: number;      // total − settledAmount（マイナスは 0 にクランプ）
    paymentStatus: PaymentStatus;
    paymentCount: number;   // 入金記録の件数
    /** 入金記録は無いが Invoice.status='paid'（旧データの後方互換で残額 0 扱い） */
    legacyPaid: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 入金サマリを算出する。
 * @param total 請求額（税込）
 * @param payments 入金記録（amount / fee のみ参照）
 * @param invoiceStatus 請求書ステータス（入金記録が無いときの後方互換判定に使用）
 */
export function computePaymentSummary(
    total: number,
    payments: Array<{ amount: number; fee: number }>,
    invoiceStatus?: string
): PaymentSummary {
    const totalNum = round2(Number(total) || 0);

    if (payments.length === 0) {
        // 入金記録が無い請求書。旧データで status='paid' のものは「全額入金済み・残額0」とみなす。
        if (invoiceStatus === 'paid') {
            return {
                paidAmount: 0, feeAmount: 0, settledAmount: 0, remaining: 0,
                paymentStatus: 'paid', paymentCount: 0, legacyPaid: true,
            };
        }
        return {
            paidAmount: 0, feeAmount: 0, settledAmount: 0, remaining: totalNum,
            paymentStatus: 'unpaid', paymentCount: 0, legacyPaid: false,
        };
    }

    const paidAmount = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const feeAmount = round2(payments.reduce((s, p) => s + (Number(p.fee) || 0), 0));
    const settledAmount = round2(paidAmount + feeAmount);
    const remainingRaw = round2(totalNum - settledAmount);
    const remaining = remainingRaw > 0 ? remainingRaw : 0;

    const paymentStatus: PaymentStatus =
        remainingRaw <= 0 ? 'paid' : settledAmount > 0 ? 'partial' : 'unpaid';

    return {
        paidAmount, feeAmount, settledAmount, remaining,
        paymentStatus, paymentCount: payments.length, legacyPaid: false,
    };
}

/** 入金状況バッジの日本語ラベル */
export function paymentStatusLabel(status: PaymentStatus): string {
    switch (status) {
        case 'paid': return '入金済';
        case 'partial': return '一部入金';
        case 'unpaid': return '未入金';
    }
}
