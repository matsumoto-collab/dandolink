/**
 * 棚卸機能のための品目マスタ整備。
 *
 * lib/materials/stocktakeSheetMap.ts の対応表を正として、
 *   1. 対応表にあって DB に無い品目（主にロック足場の材料）を作る
 *   2. 既存品目に工法区分（MaterialItem.scaffoldMethod）を付ける
 *   3. 別の品目に置き換わった品目を棚卸の対象から外す（論理削除）
 *   4. 整理が必要な状態（停止品目に在庫が残っている等）を報告する
 * を行う。
 *
 * 既定は dry-run で、何をするかを表示するだけ。実際に書き込むときだけ --apply を付ける。
 *
 *   確認   : npx tsx scripts/setup-stocktake-master.ts
 *   実行   : npx tsx scripts/setup-stocktake-master.ts --apply
 *
 * 前提: マイグレーション 20260911120000_add_stocktake が適用済みであること
 *       （MaterialItem.scaffoldMethod 列と StorageLocation テーブルが必要）。
 */
export {};

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const APPLY = process.argv.includes('--apply');

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { ALL_MAPPINGS, dbItemKey } = await import('../lib/materials/stocktakeSheetMap');

    try {
        console.log(APPLY ? '=== 実行モード（DB に書き込みます）===\n' : '=== 確認モード（dry-run / 書き込みません）===\n');

        // --- 置き場所 -------------------------------------------------------
        const locations = await prisma.storageLocation.findMany({ orderBy: { sortOrder: 'asc' } });
        console.log(`置き場所: ${locations.length ? locations.map((l) => l.name).join(' , ') : '（未登録）'}`);
        if (!locations.some((l) => l.name === '土場')) {
            console.log('  ⚠ 「土場」がありません。マイグレーションが未適用の可能性があります');
        }

        // --- 現在の DB 品目 -------------------------------------------------
        const categories = await prisma.materialCategory.findMany({ include: { items: true } });
        const catByName = new Map(categories.map((c) => [c.name, c]));
        const itemByKey = new Map<string, { id: string; categoryName: string; name: string; isActive: boolean; scaffoldMethod: string }>();
        for (const c of categories) {
            for (const i of c.items) {
                const key = dbItemKey(c.name, i.name);
                // 同名が複数ある場合は有効な方を優先（停止済みの重複行が残っているため）
                if (!itemByKey.has(key) || i.isActive) {
                    itemByKey.set(key, { id: i.id, categoryName: c.name, name: i.name, isActive: i.isActive, scaffoldMethod: i.scaffoldMethod });
                }
            }
        }

        // --- 1. 不足品目 ----------------------------------------------------
        const toCreate = ALL_MAPPINGS.filter((m) => !itemByKey.has(dbItemKey(m.category, m.item)));
        const newCategories = [...new Set(toCreate.map((m) => m.category))].filter((n) => !catByName.has(n));

        console.log(`\n--- 1. 新規作成 ---`);
        console.log(`新しいカテゴリ ${newCategories.length}件: ${newCategories.join(' , ') || '（なし）'}`);
        console.log(`新しい品目 ${toCreate.length}件:`);
        for (const m of toCreate) {
            const flags = [m.method === 'lock' ? 'ロック' : '', m.archiveOnly ? '過去データ用(非表示)' : ''].filter(Boolean).join('/');
            console.log(`   ${m.category} / ${m.item}  [${m.unit}]${flags ? ` (${flags})` : ''}${m.note ? `  ※${m.note}` : ''}`);
        }

        // --- 2. 工法タグ ----------------------------------------------------
        const toTag = ALL_MAPPINGS
            .map((m) => ({ m, db: itemByKey.get(dbItemKey(m.category, m.item)) }))
            .filter((x): x is { m: typeof ALL_MAPPINGS[number]; db: NonNullable<typeof x.db> } => !!x.db && x.db.scaffoldMethod !== x.m.method);

        console.log(`\n--- 2. 工法区分の付け替え ---`);
        console.log(`${toTag.length}件:`);
        for (const { m, db } of toTag) {
            console.log(`   ${m.category} / ${m.item}  ${db.scaffoldMethod} → ${m.method}`);
        }

        // --- 3. 置き換わった品目を棚卸の対象から外す --------------------------
        //
        // 「扉 / 扉」はエクセルでは 普 / 大 の 2 種類で数えており、この整備で
        // その 2 品目を作る。旧品目を有効なままにすると棚卸の入力欄に扉が 3 行並び、
        // どれに書けばよいか分からなくなる。在庫は 0 で、過去の出庫伝票からは
        // 引き続き参照できる（isActive=false は棚卸・新規入力から外すだけ）。
        const SUPERSEDED: { category: string; item: string; reason: string }[] = [
            { category: '扉', item: '扉', reason: '「扉 / 普」「扉 / 大」に分割' },
        ];
        const toDeactivate = SUPERSEDED.map((s) => ({ ...s, db: itemByKey.get(dbItemKey(s.category, s.item)) })).filter(
            (s) => s.db?.isActive,
        );

        console.log(`\n--- 3. 棚卸の対象から外す（論理削除・在庫と履歴はそのまま）---`);
        if (toDeactivate.length === 0) {
            console.log('   （対象なし）');
        }
        for (const s of toDeactivate) {
            console.log(`   ${s.category} / ${s.item}  ※${s.reason}`);
        }

        // --- 4. 要整理 ------------------------------------------------------
        console.log(`\n--- 4. 整理が必要な状態（このスクリプトでは触りません）---`);
        let issues = 0;
        for (const c of categories) {
            for (const i of c.items) {
                if (!i.isActive && i.stockQuantity !== 0) {
                    console.log(`   停止済みなのに在庫が残っている: ${c.name} / ${i.name}  在庫=${i.stockQuantity}`);
                    issues++;
                }
            }
        }
        const mappedKeys = new Set(ALL_MAPPINGS.map((m) => dbItemKey(m.category, m.item)));
        const unmapped = [...itemByKey.values()].filter((i) => i.isActive && !mappedKeys.has(dbItemKey(i.categoryName, i.name)));
        console.log(`   棚卸の対象外（エクセルで数えていない品目）: ${unmapped.length}件`);
        console.log(`      ${unmapped.map((i) => `${i.categoryName}/${i.name}`).join(' , ')}`);
        if (!issues) console.log('   （在庫の残った停止品目はありません）');

        // --- 書き込み -------------------------------------------------------
        if (!APPLY) {
            console.log(`\n書き込みは行っていません。実行するには --apply を付けてください。`);
            return;
        }

        console.log(`\n--- 書き込み中 ---`);
        // カテゴリ
        let maxCatOrder = Math.max(-1, ...categories.map((c) => c.sortOrder));
        for (const name of newCategories) {
            const created = await prisma.materialCategory.create({ data: { name, sortOrder: ++maxCatOrder } });
            catByName.set(name, { ...created, items: [] });
            console.log(`   カテゴリ作成: ${name}`);
        }
        // 品目
        const orderByCat = new Map<string, number>();
        for (const c of categories) orderByCat.set(c.name, Math.max(-1, ...c.items.map((i) => i.sortOrder)));
        for (const m of toCreate) {
            const cat = catByName.get(m.category);
            if (!cat) throw new Error(`カテゴリが見つかりません: ${m.category}`);
            const next = (orderByCat.get(m.category) ?? -1) + 1;
            orderByCat.set(m.category, next);
            await prisma.materialItem.create({
                data: {
                    categoryId: cat.id,
                    name: m.item,
                    spec: m.spec,
                    unit: m.unit,
                    sortOrder: next,
                    isActive: !m.archiveOnly,
                    scaffoldMethod: m.method,
                },
            });
        }
        console.log(`   品目作成: ${toCreate.length}件`);
        // 工法タグ
        for (const { m, db } of toTag) {
            await prisma.materialItem.update({ where: { id: db.id }, data: { scaffoldMethod: m.method } });
        }
        console.log(`   工法区分の更新: ${toTag.length}件`);
        // 置き換わった品目を棚卸の対象から外す
        for (const s of toDeactivate) {
            await prisma.materialItem.update({ where: { id: s.db!.id }, data: { isActive: false } });
        }
        console.log(`   棚卸の対象から外した品目: ${toDeactivate.length}件`);
        console.log('\n完了しました。');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
