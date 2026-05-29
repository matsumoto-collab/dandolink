import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * 請求書採番（invoiceNumber 衝突）に強い Invoice 作成ヘルパ。
 *
 * 設計根拠（invoice_plan.md §17.27.6）:
 * - §12.4 旧案 α（`tx.invoice.create` の P2002 を **トランザクション内**で catch→continue）は
 *   PostgreSQL の仕様で **破綻する**。tx 内で 1 度でもエラーが出ると以降のクエリは
 *   `current transaction is aborted (25P02)` で全て弾かれ、Prisma の interactive transaction は
 *   各クエリを SAVEPOINT で包まないため自前回復できない。
 * - よって **リトライをトランザクションの外側**に出す（毎回新しい tx でやり直す）。
 * - さらに `pg_advisory_xact_lock` で採番を直列化し、衝突をそもそも起こさない
 *   （xact ロックは COMMIT/ROLLBACK で自動解放）。リトライは保険。
 */

/** 採番直列化用の advisory lock キー（請求書番号採番専用の固定値、int4 範囲）。 */
const INVOICE_NUMBER_LOCK_KEY = 728341;

/** invoiceNumber の一意制約違反（P2002）かどうかを判定。 */
export function isInvoiceNumberConflict(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        (error.meta!.target as string[]).includes('invoiceNumber')
    );
}

/**
 * 次の請求書番号 `I{西暦4桁}{連番4桁}`（例 `I20260001`）を採番する。
 * 既存単発 POST（app/api/invoices/route.ts）と同一ロジック。
 */
export async function computeNextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `I${new Date().getFullYear()}`;
    const latest = await tx.invoice.findFirst({
        where: { invoiceNumber: { startsWith: prefix } },
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true },
    });
    let nextSeq = 1;
    if (latest) {
        const seq = parseInt(latest.invoiceNumber.replace(prefix, ''), 10);
        if (!isNaN(seq)) nextSeq = seq + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Invoice をトランザクション内で作成する。採番（advisory lock + 連番計算）を行い、
 * 採番済み番号を `run` に渡す。`run` の中で `tx.invoice.create({ data: { ..., invoiceNumber } })`
 * および付随処理（InvoiceProjectMaster / BillingDraft 更新 / バージョン）を行うこと。
 *
 * invoiceNumber 衝突（P2002）のときのみ、**新しいトランザクション**で最大 `maxRetries` 回リトライ。
 * それ以外のエラーは即時 throw。
 *
 * @param run 採番済み invoiceNumber を受け取り、Invoice 作成と付随処理を行うコールバック
 * @param maxRetries 最大試行回数（既定 5）
 */
export async function createInvoiceWithRetry<T>(
    run: (tx: Prisma.TransactionClient, invoiceNumber: string) => Promise<T>,
    maxRetries = 5,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await prisma.$transaction(async (tx) => {
                // 採番を直列化（同時実行でも同じ番号を引かない）。pg_advisory_xact_lock は
                // bigint 1 引数のオーバーロードのみのため明示キャストする。
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_NUMBER_LOCK_KEY}::bigint)`;
                const invoiceNumber = await computeNextInvoiceNumber(tx);
                return await run(tx, invoiceNumber);
            });
        } catch (error) {
            lastError = error;
            // 採番衝突のみ、新しい tx でリトライ。それ以外は即時 throw。
            if (isInvoiceNumberConflict(error)) continue;
            throw error;
        }
    }
    // リトライを使い切っても衝突が解消しなかった場合は最後のエラーを throw
    throw lastError;
}
