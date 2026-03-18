/**
 * マイグレーションスクリプト: 旧テンプレートキー → 新UnitPriceTemplateテーブル
 *
 * 使い方:
 *   DIRECT_URL="postgresql://..." npx tsx scripts/migrate-unit-price-templates.ts
 *
 * 1. UnitPriceTemplate に旧4種を INSERT
 * 2. UnitPriceMaster.templates JSON内の文字列キーをUUIDに置換
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEGACY_TEMPLATES = [
    { key: 'frequent', name: 'よく使う項目', sortOrder: 0 },
    { key: 'large', name: '大規模見積用', sortOrder: 1 },
    { key: 'medium', name: '中規模見積用', sortOrder: 2 },
    { key: 'residential', name: '住宅見積用', sortOrder: 3 },
];

async function main() {
    console.log('=== 単価マスター テンプレート移行開始 ===');

    // 1. 旧テンプレートをUnitPriceTemplateに作成
    const keyToId = new Map<string, string>();

    for (const lt of LEGACY_TEMPLATES) {
        // 既に同名が存在するかチェック
        const existing = await prisma.unitPriceTemplate.findFirst({
            where: { name: lt.name, isActive: true },
        });
        if (existing) {
            keyToId.set(lt.key, existing.id);
            console.log(`  既存: ${lt.name} → ${existing.id}`);
        } else {
            const created = await prisma.unitPriceTemplate.create({
                data: { name: lt.name, sortOrder: lt.sortOrder },
            });
            keyToId.set(lt.key, created.id);
            console.log(`  作成: ${lt.name} → ${created.id}`);
        }
    }

    // 2. UnitPriceMaster.templates の旧キーをUUIDに置換
    const allMasters = await prisma.unitPriceMaster.findMany();
    let updated = 0;

    for (const master of allMasters) {
        let templates: string[];
        try {
            templates = JSON.parse(master.templates);
        } catch {
            console.warn(`  JSON解析失敗: ${master.id} → スキップ`);
            continue;
        }

        // 旧キーが含まれているか
        const hasLegacy = templates.some(t => keyToId.has(t));
        if (!hasLegacy) continue;

        const newTemplates = templates.map(t => keyToId.get(t) ?? t);
        await prisma.unitPriceMaster.update({
            where: { id: master.id },
            data: { templates: JSON.stringify(newTemplates) },
        });
        updated++;
        console.log(`  更新: ${master.description} (${master.id})`);
    }

    console.log(`\n=== 完了: テンプレート${keyToId.size}件作成、単価マスター${updated}件更新 ===`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
