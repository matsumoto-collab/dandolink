/**
 * 材料マスター 冪等 upsert スクリプト（catalog.ts を単一の正とする）
 *
 * 注意: DB 不要の「正」の構造検証は Jest テスト
 *   （npm test -- __tests__/lib/materials/catalog.test.ts）であり、
 *   本スクリプトおよび verify スクリプトの `npx tsx` 実行はベストエフォート。
 *
 * 実行: DIRECT_URL="..." npx tsx scripts/seed-materials-from-catalog.ts
 *
 * 振る舞い:
 *   - lib/materials/catalog.ts の CATALOG_CATEGORIES / CATALOG_ITEMS を upsert
 *   - 自然キー = (カテゴリ名) / (カテゴリ名 + 品目名)。create-or-update（冪等）
 *   - sortOrder / unit / spec / stockQuantity も catalog に同期
 *     （stockQuantity は初期投入時のみ initialStock を設定。既存品目の在庫数は維持）
 *   - catalog に無い既存品目 / カテゴリは物理削除せず isActive=false で論理無効化
 *     （FK 制約尊重。requisition 等から参照されていても安全）
 *   - 何度実行しても結果が収束する（idempotent）
 *
 * 注意: 旧スクリプト scripts/seed-materials.ts は削除しない（残置）。
 */
import { PrismaClient } from '@prisma/client';
import {
    CATALOG_CATEGORIES,
    CATALOG_ITEMS,
    naturalKey,
} from '../lib/materials/catalog';

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
    if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
        console.error('ERROR: DIRECT_URL（または DATABASE_URL）が未設定です。');
        console.error('  例: DIRECT_URL="postgresql://..." npx tsx scripts/seed-materials-from-catalog.ts');
        process.exit(1);
    }

    console.log('材料マスター 冪等 upsert 開始（catalog.ts 基準）...');
    console.log(`  catalog: ${CATALOG_CATEGORIES.length} カテゴリ / ${CATALOG_ITEMS.length} 品目`);

    // ---- 1. カテゴリ upsert（自然キー = name） ----
    const categoryIdByName = new Map<string, string>();
    for (const cat of CATALOG_CATEGORIES) {
        const existing = await prisma.materialCategory.findFirst({ where: { name: cat.name } });
        if (existing) {
            const updated = await prisma.materialCategory.update({
                where: { id: existing.id },
                data: { sortOrder: cat.sortOrder, isActive: true },
            });
            categoryIdByName.set(cat.name, updated.id);
        } else {
            const created = await prisma.materialCategory.create({
                data: { name: cat.name, sortOrder: cat.sortOrder, isActive: true },
            });
            categoryIdByName.set(cat.name, created.id);
            console.log(`  + カテゴリ新規: ${cat.name}`);
        }
    }

    // ---- 2. 品目 upsert（自然キー = categoryId + name） ----
    const catalogKeySet = new Set<string>();
    let createdItems = 0;
    let updatedItems = 0;
    for (const it of CATALOG_ITEMS) {
        const categoryId = categoryIdByName.get(it.categoryName);
        if (!categoryId) {
            throw new Error(`カテゴリ未解決: ${it.categoryName}（catalog の整合を確認）`);
        }
        catalogKeySet.add(naturalKey(it.categoryName, it.itemName));

        const existing = await prisma.materialItem.findFirst({
            where: { categoryId, name: it.itemName },
        });
        if (existing) {
            await prisma.materialItem.update({
                where: { id: existing.id },
                data: {
                    unit: it.unit,
                    spec: it.specLabel,
                    sortOrder: it.itemSortOrder,
                    isActive: true,
                    // stockQuantity は既存値を維持（在庫の実数を seed が破壊しない）
                },
            });
            updatedItems += 1;
        } else {
            await prisma.materialItem.create({
                data: {
                    categoryId,
                    name: it.itemName,
                    unit: it.unit,
                    spec: it.specLabel,
                    sortOrder: it.itemSortOrder,
                    isActive: true,
                    stockQuantity: it.initialStock, // 新規のみ初期在庫（Phase 1 は全品目 0）
                },
            });
            createdItems += 1;
        }
    }

    // ---- 3. catalog に無い既存品目を論理無効化（物理削除しない） ----
    const allDbItems = await prisma.materialItem.findMany({
        include: { category: true },
    });
    let deactivatedItems = 0;
    for (const dbItem of allDbItems) {
        const key = naturalKey(dbItem.category.name, dbItem.name);
        if (!catalogKeySet.has(key) && dbItem.isActive) {
            await prisma.materialItem.update({
                where: { id: dbItem.id },
                data: { isActive: false },
            });
            deactivatedItems += 1;
            console.log(`  - 論理無効化(item): ${key}`);
        }
    }

    // ---- 4. 品目が 1 件も active で残らないカテゴリを論理無効化 ----
    const catalogCatNames = new Set(CATALOG_CATEGORIES.map((c) => c.name));
    const allDbCats = await prisma.materialCategory.findMany({
        include: { items: true },
    });
    let deactivatedCats = 0;
    for (const dbCat of allDbCats) {
        if (catalogCatNames.has(dbCat.name)) continue;
        if (!dbCat.isActive) continue;
        await prisma.materialCategory.update({
            where: { id: dbCat.id },
            data: { isActive: false },
        });
        deactivatedCats += 1;
        console.log(`  - 論理無効化(category): ${dbCat.name}`);
    }

    console.log('\n完了（冪等）:');
    console.log(`  品目: 新規 ${createdItems} / 更新 ${updatedItems} / 論理無効化 ${deactivatedItems}`);
    console.log(`  カテゴリ: 論理無効化 ${deactivatedCats}`);
    console.log('  ※ 再実行しても結果は収束します。物理削除は行いません。');
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
