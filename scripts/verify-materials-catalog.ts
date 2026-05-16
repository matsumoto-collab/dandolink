/**
 * 材料カタログ 構造検証スクリプト（DB 不要）
 *
 * 実行: npx tsx scripts/verify-materials-catalog.ts
 *   （tsx が無い環境では同等の検証を Jest で実行可能:
 *     npm test -- __tests__/lib/materials/catalog.test.ts）
 *
 * catalog.ts を import し、DB に接続せず不変条件を assert する。
 *   - 自然キー (categoryName + itemName) が一意
 *   - 全品目に PDF 列配置がある（column が COL1/COL2/COL3 のいずれか）
 *   - SHEET_TYPES が 7 件・重複なし・「新素用」誤字が無い
 *   - 列内 (column + groupLabel) の orderInGroup に重複が無い
 *   - カテゴリ内 itemSortOrder に重複が無い
 *   - initialStock は全品目 0（Phase 1 要件）
 *   - countByColumn の合計が品目総数と一致
 */
import {
    CATALOG_ITEMS,
    CATALOG_CATEGORIES,
    SHEET_TYPES,
    countByColumn,
    naturalKey,
} from '../lib/materials/catalog';

const failures: string[] = [];
function check(cond: boolean, msg: string) {
    if (!cond) failures.push(msg);
}

// 1. 自然キー一意
{
    const seen = new Set<string>();
    for (const it of CATALOG_ITEMS) {
        const k = naturalKey(it.categoryName, it.itemName);
        check(!seen.has(k), `自然キー重複: ${k}`);
        seen.add(k);
    }
}

// 2. 全品目に列配置あり
for (const it of CATALOG_ITEMS) {
    check(
        ['COL1', 'COL2', 'COL3'].includes(it.pdf.column),
        `列配置不正: ${naturalKey(it.categoryName, it.itemName)} -> ${it.pdf.column}`,
    );
    check(
        Number.isInteger(it.pdf.orderInGroup) && it.pdf.orderInGroup >= 0,
        `orderInGroup 不正: ${naturalKey(it.categoryName, it.itemName)}`,
    );
}

// 3. SHEET_TYPES
check(SHEET_TYPES.length === 7, `SHEET_TYPES は 7 件であること（実際: ${SHEET_TYPES.length}）`);
check(new Set(SHEET_TYPES).size === SHEET_TYPES.length, 'SHEET_TYPES に重複');
check(
    !SHEET_TYPES.some((s) => s.includes('新素用')),
    'SHEET_TYPES に誤字「新素用」が残存（「新築用」であること）',
);
check(
    SHEET_TYPES.some((s) => s.includes('新築用')),
    'SHEET_TYPES に「新築用」が含まれること',
);

// 4. 列内グループ (column+groupIndex) の orderInGroup 重複なし
{
    const map = new Map<string, Set<number>>();
    for (const it of CATALOG_ITEMS) {
        const gk = `${it.pdf.column}|${it.pdf.groupIndex}`;
        if (!map.has(gk)) map.set(gk, new Set());
        const set = map.get(gk)!;
        check(!set.has(it.pdf.orderInGroup), `グループ内 orderInGroup 重複: ${gk} #${it.pdf.orderInGroup}`);
        set.add(it.pdf.orderInGroup);
    }
}

// 5. カテゴリ内 itemSortOrder 重複なし
{
    const map = new Map<string, Set<number>>();
    for (const it of CATALOG_ITEMS) {
        if (!map.has(it.categoryName)) map.set(it.categoryName, new Set());
        const set = map.get(it.categoryName)!;
        check(
            !set.has(it.itemSortOrder),
            `カテゴリ内 itemSortOrder 重複: ${it.categoryName} #${it.itemSortOrder}`,
        );
        set.add(it.itemSortOrder);
    }
}

// 6. initialStock は全品目 0
for (const it of CATALOG_ITEMS) {
    check(
        it.initialStock === 0,
        `initialStock は 0 であること: ${naturalKey(it.categoryName, it.itemName)} = ${it.initialStock}`,
    );
}

// 7. countByColumn 合計 = 品目総数
{
    const c = countByColumn();
    check(
        c.COL1 + c.COL2 + c.COL3 === CATALOG_ITEMS.length,
        `列別合計(${c.COL1 + c.COL2 + c.COL3}) != 品目総数(${CATALOG_ITEMS.length})`,
    );
}

// 8. カテゴリは catalog 品目から漏れなく導出されている
{
    const catSet = new Set(CATALOG_CATEGORIES.map((c) => c.name));
    for (const it of CATALOG_ITEMS) {
        check(catSet.has(it.categoryName), `CATALOG_CATEGORIES にカテゴリ欠落: ${it.categoryName}`);
    }
}

const c = countByColumn();
console.log('--- 材料カタログ構造検証 ---');
console.log(`カテゴリ数        : ${CATALOG_CATEGORIES.length}`);
console.log(`品目総数          : ${CATALOG_ITEMS.length}`);
console.log(`COL1 / COL2 / COL3: ${c.COL1} / ${c.COL2} / ${c.COL3}`);
console.log(`SHEET_TYPES       : ${SHEET_TYPES.join(', ')}`);

if (failures.length > 0) {
    console.error(`\nNG: ${failures.length} 件の不変条件違反`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('\nOK: 全不変条件をパス（green）');
