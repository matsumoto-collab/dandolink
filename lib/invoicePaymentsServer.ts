import type { InvoicePayment } from '@prisma/client';
import type { InvoicePaymentRecord } from './invoicePayments';

/** Prisma の InvoicePayment を API レスポンス形へ変換（サーバー専用。Decimal→number / Date→ISO） */
export function formatInvoicePayment(p: InvoicePayment): InvoicePaymentRecord {
    return {
        id: p.id,
        invoiceId: p.invoiceId,
        paidDate: p.paidDate.toISOString(),
        amount: Number(p.amount),
        fee: Number(p.fee),
        method: p.method,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
        createdBy: p.createdBy,
    };
}
