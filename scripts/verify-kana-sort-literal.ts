/**
 * 読み取り専用の検証: 支払リストの名義あいうえお順（文字どおり比較・法人格も名前の一部）を
 * 本番の実データで並べて目視確認する。
 * 実行: npx tsx scripts/verify-kana-sort-literal.ts
 */
import { PrismaClient } from '@prisma/client';
import { payeeNameSortValue } from '../lib/kanaSort';

const baseUrl = process.env.DATABASE_URL ?? '';
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'connection_limit=1';
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
    const items = await prisma.paymentSchedule.findMany({
        select: { accountHolder: true, payeeName: true, payee: { select: { nameKana: true } } },
    });
    console.log(`paymentSchedules: ${items.length}`);

    // UI と同じキーで一意化して並べる
    const seen = new Map<string, string>(); // key -> 表示名
    for (const it of items) {
        const key = payeeNameSortValue({
            accountHolder: it.accountHolder,
            nameKana: it.payee?.nameKana,
            payeeName: it.payeeName,
        });
        if (!key) continue;
        const label = it.accountHolder || it.payee?.nameKana || it.payeeName || '';
        if (!seen.has(key)) seen.set(key, label);
    }
    const sorted = Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ja'));
    console.log(`unique names: ${sorted.length}`);
    console.log('--- あいうえお順（文字どおり） ---');
    for (const [, label] of sorted) console.log(label);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
