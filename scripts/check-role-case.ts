/**
 * User.role の大文字小文字混在を調査する読み取り専用スクリプト
 *
 * 背景: 書き込み経路によって role の大小文字が混在し得る
 *   - users API (POST/PATCH): toUpperCase() で保存 → 'ADMIN' 等
 *   - schema default: "manager"（小文字）
 *   - init-db: 'ADMIN'
 * 読み側に case-sensitive な比較が残っているため（users GET の role IN フィルタ、
 * users/[id] DELETE の === 'PARTNER' ガード）、混在実態を確認する。
 *
 * 実行: npx tsx scripts/check-role-case.ts
 * ※ SELECT のみ。書き込みは一切行わない。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const groups = await prisma.user.groupBy({
        by: ['role', 'isActive'],
        _count: { _all: true },
        orderBy: [{ role: 'asc' }, { isActive: 'desc' }],
    });

    console.log('=== role 生値 × isActive 別件数 ===');
    for (const g of groups) {
        console.log(`  role="${g.role}"  isActive=${g.isActive}  count=${g._count._all}`);
    }

    // 小文字化した同一グループ内に複数の表記があるものを検出
    const byLower = new Map<string, Set<string>>();
    for (const g of groups) {
        const lower = g.role.toLowerCase();
        if (!byLower.has(lower)) byLower.set(lower, new Set());
        byLower.get(lower)!.add(g.role);
    }

    console.log('\n=== 判定 ===');
    let mixed = false;
    for (const [lower, variants] of byLower) {
        if (variants.size > 1) {
            mixed = true;
            console.log(`  ⚠ 混在: ${lower} → [${[...variants].join(', ')}]`);
        }
    }
    const nonUpper = [...byLower.values()].flatMap(s => [...s]).filter(r => r !== r.toUpperCase());
    if (nonUpper.length > 0) {
        console.log(`  ⚠ 大文字でない表記: ${nonUpper.join(', ')}`);
        console.log('    → users GET の role INフィルタ(大文字前提)はこれらの行を取りこぼす');
        console.log('    → users/[id] DELETE の === \'PARTNER\' ガードも素通りする');
    }
    if (!mixed && nonUpper.length === 0) {
        console.log('  ✅ 混在なし（全行が大文字表記）。コード側の規約統一のみでOK');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
