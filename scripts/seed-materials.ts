/**
 * 材料マスター初期データ投入スクリプト
 *
 * 実行: DIRECT_URL="..." npx tsx scripts/seed-materials.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const SEED_DATA: Array<{ name: string; items: Array<{ name: string; unit?: string }> }> = [
    { name: '柱', items: [
        { name: '3.6m' }, { name: '2.7m' }, { name: '1.8m' }, { name: '0.9m' },
        { name: '調整' }, { name: '1コマ' }, { name: '0.9切' },
    ]},
    { name: '手摺', items: [
        { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
        { name: '0.4m' }, { name: '0.3m' }, { name: '0.2m' }, { name: 'サイド' }, { name: 'イボ0.6' },
    ]},
    { name: '400アンチ', items: [
        { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: '250ハーフ', items: [
        { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: 'センターハーフ', items: [
        { name: '0.4m' }, { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: '筋交', items: [
        { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' },
    ]},
    { name: 'ブラケット', items: [
        { name: '0.4m' }, { name: '0.8m' }, { name: '0.6m' },
    ]},
    { name: 'ピン付き', items: [
        { name: '0.4m' }, { name: '0.2m' },
    ]},
    { name: '階段', items: [
        { name: '鉄', unit: '台' }, { name: 'アルミ', unit: '台' }, { name: '3段', unit: '台' }, { name: '階段下' },
    ]},
    { name: 'ジャッキ', items: [
        { name: '固定' }, { name: '下屋' },
    ]},
    { name: '皿 / 兼用皿', items: [
        { name: '皿', unit: '枚' }, { name: '兼用皿', unit: '枚' },
    ]},
    { name: 'ルーフベース', items: [
        { name: 'ルーフベース' },
    ]},
    { name: '単管', items: [
        { name: '6m' }, { name: '5m' }, { name: '4m' }, { name: '3m' },
        { name: '2m' }, { name: '1.5m' }, { name: '1m' }, { name: '0.5m' },
    ]},
    { name: 'クランプ', items: [
        { name: '直交', unit: '個' }, { name: '自在', unit: '個' }, { name: '3連', unit: '個' },
        { name: 'シート', unit: '個' }, { name: '養生', unit: '個' },
    ]},
    { name: '鉄骨', items: [
        { name: '直交', unit: '個' }, { name: '自在', unit: '個' },
    ]},
    { name: 'ジョイント', items: [
        { name: 'ジョイント', unit: '個' },
    ]},
    { name: '単管ベース', items: [
        { name: '単管ベース', unit: '個' },
    ]},
    { name: 'ネット', items: [
        { name: '新素用 青(紐付)', unit: '枚' }, { name: 'グレー5.4', unit: '枚' },
        { name: 'グレー6.3', unit: '枚' }, { name: '青', unit: '枚' },
        { name: '黒', unit: '枚' }, { name: '緑', unit: '枚' }, { name: '白', unit: '枚' },
    ]},
    { name: 'カヤシート', items: [
        { name: 'カヤシート', unit: '枚' },
    ]},
    { name: 'ヒモ', items: [
        { name: 'ヒモ', unit: '巻' },
    ]},
    { name: '壁つなぎ', items: [
        { name: '14～17' }, { name: '19～24' }, { name: '24～34' },
        { name: '33～52' }, { name: '50～72' }, { name: '70～92' },
    ]},
    { name: '道板', items: [
        { name: '4m', unit: '枚' }, { name: '3m', unit: '枚' }, { name: '2m', unit: '枚' }, { name: '1m', unit: '枚' },
    ]},
    { name: '巾木（木製）', items: [
        { name: '4m' }, { name: '2m' },
    ]},
    { name: 'L型巾木', items: [
        { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: 'L型巾木（養用）', items: [
        { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: 'アダプター', items: [
        { name: '柱用', unit: '個' }, { name: 'アンチ', unit: '個' },
    ]},
    { name: 'ジャッキカバー', items: [
        { name: 'ジャッキカバー', unit: '個' },
    ]},
    { name: 'コッパ', items: [
        { name: 'コッパ' },
    ]},
    { name: 'チョウチョ', items: [
        { name: 'チョウチョ', unit: '個' },
    ]},
    { name: '先行手摺', items: [
        { name: '1.8m' }, { name: '1.2m' }, { name: '0.9m' }, { name: '0.6m' },
    ]},
    { name: '梁枠', items: [
        { name: '3.6m' }, { name: '5.4m' },
    ]},
    { name: '安全バー', items: [
        { name: '安全バー' },
    ]},
    { name: '金網', items: [
        { name: '金網', unit: '枚' },
    ]},
    { name: '杭', items: [
        { name: '杭' },
    ]},
    { name: 'ローリングタイヤ', items: [
        { name: 'ローリングタイヤ', unit: '個' },
    ]},
    { name: 'ハッチ付きアンチ', items: [
        { name: 'ハッチ付きアンチ', unit: '枚' },
    ]},
    { name: 'タラップ', items: [
        { name: 'タラップ', unit: '台' },
    ]},
    { name: '朝顔', items: [
        { name: '朝顔', unit: 'セット' },
    ]},
    { name: '単クランプ', items: [
        { name: '単クランプ', unit: '個' },
    ]},
    { name: '羽子板クランプ', items: [
        { name: '羽子板クランプ', unit: '個' },
    ]},
    { name: '親綱', items: [
        { name: '親綱', unit: 'm' },
    ]},
    { name: '足場表示看板', items: [
        { name: '足場表示看板', unit: '枚' },
    ]},
    { name: 'イメージシート', items: [
        { name: 'イメージシート', unit: '枚' },
    ]},
    { name: 'ラッセルネット', items: [
        { name: 'ラッセルネット', unit: '枚' },
    ]},
    { name: '階段手摺', items: [
        { name: '階段手摺' },
    ]},
    { name: 'レール', items: [
        { name: 'レール' },
    ]},
    { name: '養生カバー', items: [
        { name: '大', unit: '枚' }, { name: '小', unit: '枚' },
    ]},
    { name: '番線', items: [
        { name: '巾木', unit: '巻' }, { name: '巻き', unit: '巻' },
    ]},
    { name: '扉', items: [
        { name: '扉', unit: '枚' },
    ]},
    { name: 'リース品', items: [
        { name: 'リース品', unit: '式' },
    ]},
];

async function main() {
    console.log('材料マスターのシード開始...');

    // 既存データがある場合はスキップ
    const existing = await prisma.materialCategory.count();
    if (existing > 0) {
        console.log(`既に${existing}カテゴリが登録済みです。スキップします。`);
        return;
    }

    for (let i = 0; i < SEED_DATA.length; i++) {
        const cat = SEED_DATA[i];
        const category = await prisma.materialCategory.create({
            data: {
                name: cat.name,
                sortOrder: i,
            },
        });

        for (let j = 0; j < cat.items.length; j++) {
            const item = cat.items[j];
            await prisma.materialItem.create({
                data: {
                    categoryId: category.id,
                    name: item.name,
                    unit: item.unit || '本',
                    sortOrder: j,
                },
            });
        }

        console.log(`  ✓ ${cat.name} (${cat.items.length}品目)`);
    }

    console.log(`\n完了！ ${SEED_DATA.length}カテゴリ、${SEED_DATA.reduce((s, c) => s + c.items.length, 0)}品目を登録しました。`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
