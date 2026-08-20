/**
 * 請求漏れの見張り（lib/billingWatch）の dry-run。読み取り専用で、通知は一切送らない。
 * 誰に何件の「判断待ち」通知が飛ぶかを送信前に確認する。
 *
 * 使い方: npx tsx scripts/dry-run-billing-watch.ts
 */
export {}; // モジュール化（他スクリプトとのトップレベル変数衝突を防ぐ）

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { collectBillingWatchItems } = await import('../lib/billingWatch');
    try {
        const items = await collectBillingWatchItems();
        console.log(`検知: ${items.length}件`);
        for (const it of items.slice(0, 30)) {
            console.log(`  ${it.closingYmd} ${it.text} (担当=${it.assigneeIds.length}人)`);
        }
        if (items.length > 30) console.log(`  …ほか${items.length - 30}件`);

        const userIds = Array.from(new Set(items.flatMap((i) => i.assigneeIds)));
        const users = userIds.length
            ? await prisma.user.findMany({
                  where: { id: { in: userIds }, isActive: true },
                  select: { id: true, displayName: true },
              })
            : [];
        const nameById = new Map(users.map((u) => [u.id, u.displayName]));
        const countByUser = new Map<string, number>();
        for (const it of items) {
            for (const uid of it.assigneeIds) {
                if (!nameById.has(uid)) continue;
                countByUser.set(uid, (countByUser.get(uid) ?? 0) + 1);
            }
        }
        console.log('\n通知先（在籍担当者のみ）:');
        if (countByUser.size === 0) console.log('  なし');
        for (const [uid, n] of Array.from(countByUser.entries()).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${nameById.get(uid)}: ${n}件`);
        }
        const orphan = items.filter((i) => i.assigneeIds.every((id) => !nameById.has(id)));
        if (orphan.length) console.log(`\n担当者未設定/退職者のみ（通知されない）: ${orphan.length}件`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
