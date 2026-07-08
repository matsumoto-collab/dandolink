/**
 * 顧客名同期(a7e78b6)導入前のリネームで生じた案件スナップショットのドリフトを修復する一回きりのバックフィル。
 * customerId でリンク済みの ProjectMaster について、customerName / customerShortName を顧客マスタの現在値に揃える。
 * updatedAt を進めないよう raw SQL で更新（API の同期処理と同じ方針）。
 *   確認: npx tsx scripts/sync-pm-customer-name-drift.ts          （dry-run・書込なし）
 *   適用: npx tsx scripts/sync-pm-customer-name-drift.ts --apply
 */
import { PrismaClient } from '@prisma/client';

// ローカル .env はセッションモード(:5432)なので接続は1本に制限する
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

const APPLY = process.argv.includes('--apply');

async function main() {
    const pms = await prisma.projectMaster.findMany({
        where: { customerId: { not: null } },
        select: { id: true, title: true, customerId: true, customerName: true, customerShortName: true },
    });
    const customers = await prisma.customer.findMany({ select: { id: true, name: true, shortName: true } });
    const cmap = new Map(customers.map((c) => [c.id, c]));

    const drifted = pms.filter((p) => {
        const c = cmap.get(p.customerId!);
        if (!c) return false;
        return p.customerName !== c.name || (p.customerShortName ?? null) !== (c.shortName ?? null);
    });

    console.log(`リンク済み案件 ${pms.length} 件中、ドリフト ${drifted.length} 件${APPLY ? ''  : '（dry-run・書込なし）'}`);
    for (const p of drifted) {
        const c = cmap.get(p.customerId!)!;
        console.log(`- ${p.title}`);
        if (p.customerName !== c.name) console.log(`    customerName: "${p.customerName}" → "${c.name}"`);
        if ((p.customerShortName ?? null) !== (c.shortName ?? null)) console.log(`    customerShortName: "${p.customerShortName ?? ''}" → "${c.shortName ?? ''}"`);
        if (APPLY) {
            await prisma.$executeRaw`
                UPDATE "ProjectMaster"
                SET "customerName" = ${c.name}, "customerShortName" = ${c.shortName ?? null}
                WHERE "id" = ${p.id}
            `;
        }
    }
    if (APPLY) console.log(`✅ ${drifted.length} 件を更新しました`);
    else console.log('適用するには --apply を付けて実行してください');
}

main().finally(() => prisma.$disconnect());
