/**
 * 材料管理表エクセル（🈟材料管理表.xlsx）の過去の棚卸をシステムへ取り込む。
 *
 * エクセルは「品目 × 棚卸日」の横持ちで、日付の入った列 1 本が 1 回の実地棚卸。
 * それを Stocktake / StocktakeLine（縦持ち）へ移す。
 *
 * 数量欄には数字以外が混ざっている（"many" "◎新品150" "1560/色無800" "1900+上野" 等）。
 * 先頭が数字ならその数を数量に、そうでなければ数量は null（＝数えていない）にして、
 * どちらの場合も原文を note に残す。集計できる形にしつつ、書いた内容は捨てない。
 *
 *   確認   : npx tsx scripts/import-stocktake-excel.ts
 *   実行   : npx tsx scripts/import-stocktake-excel.ts --apply
 *   ロックの「残合計」列も 1 回分として取り込む:
 *            npx tsx scripts/import-stocktake-excel.ts --lock-total-date=2026-07-28 --apply
 *   在庫を棚卸から再計算する（既定では在庫に触らない）:
 *            npx tsx scripts/import-stocktake-excel.ts --apply --recompute-stock
 *
 * 前提: マイグレーション 20260911120000_add_stocktake の適用と
 *       scripts/setup-stocktake-master.ts --apply が済んでいること。
 */
export {};

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const XLSX_PATH = process.env.STOCKTAKE_XLSX ?? 'C:/Users/yushink/Desktop/🈟材料管理表.xlsx';
const APPLY = process.argv.includes('--apply');
const RECOMPUTE_STOCK = process.argv.includes('--recompute-stock');
const lockTotalArg = process.argv.find((a) => a.startsWith('--lock-total-date='));
const LOCK_TOTAL_DATE = lockTotalArg ? lockTotalArg.split('=')[1] : null;

/** JST のその日の 0 時を表す UTC 時刻（Stocktake.date の保存形式） */
function jstDayStartUtc(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 60 * 60 * 1000);
}

function toYmd(value: Date): string {
    // エクセルの日付セルは UTC 0 時で入っているのでそのまま年月日を読む
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
    const ExcelJS = (await import('exceljs')).default;
    const { prisma } = await import('../lib/prisma');
    const { SHEET_SOURCES, lookupMapping, dbItemKey, parseSheetCellValue } = await import('../lib/materials/stocktakeSheetMap');
    const { STOCKTAKE_STATUS, computeStockFromStocktakes } = await import('../lib/materials/stocktake');
    const { applyInventoryAdjustment } = await import('../lib/materials/stock');

    try {
        console.log(APPLY ? '=== 実行モード（DB に書き込みます）===\n' : '=== 確認モード（dry-run / 書き込みません）===\n');
        console.log(`読み込み: ${XLSX_PATH}\n`);

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(XLSX_PATH);

        // --- DB 側の索引 ---------------------------------------------------
        const locations = await prisma.storageLocation.findMany();
        const locationByName = new Map(locations.map((l) => [l.name, l]));
        const categories = await prisma.materialCategory.findMany({ include: { items: true } });
        const itemIdByKey = new Map<string, string>();
        for (const c of categories) {
            for (const i of c.items) {
                const key = dbItemKey(c.name, i.name);
                if (!itemIdByKey.has(key) || i.isActive) itemIdByKey.set(key, i.id);
            }
        }

        type PendingLine = { materialItemId: string; quantity: number | null; note: string | null };
        type PendingStocktake = {
            locationId: string;
            locationName: string;
            method: 'standard' | 'lock';
            ymd: string;
            columnLabel: string;
            lines: PendingLine[];
        };
        const pending: PendingStocktake[] = [];
        const unmappedRows = new Set<string>();
        const missingItems = new Set<string>();

        for (const source of SHEET_SOURCES) {
            const ws = wb.getWorksheet(source.sheet);
            if (!ws) {
                console.log(`⚠ シート「${source.sheet}」が見つかりません`);
                continue;
            }
            const location = locationByName.get(source.locationName);
            if (!location) {
                console.log(`⚠ 置き場所「${source.locationName}」が DB にありません（マイグレーション未適用？）`);
                continue;
            }

            // --- 日付列を洗い出す ------------------------------------------
            const dateColumns: { index: number; ymd: string; label: string }[] = [];
            for (let c = 3; c <= ws.columnCount; c++) {
                const letter = ws.getColumn(c).letter;
                const header = ws.getCell(1, c).value;
                if (header instanceof Date) {
                    const ymd = toYmd(header);
                    // 見出しの日付が明らかな打ち間違いの列は正しい日付に直す
                    const override = source.dateOverrides?.find((o) => o.column === letter && o.wrongDate === ymd);
                    if (override) {
                        console.log(
                            `   ※ ${source.sheet}シート ${letter}列の日付を ${ymd} → ${override.date} に補正（${override.reason}）`,
                        );
                        dateColumns.push({ index: c, ymd: override.date, label: `${letter}列(日付補正)` });
                        continue;
                    }
                    dateColumns.push({ index: c, ymd, label: `${letter}列` });
                    continue;
                }
                const literal = source.literalDateColumns?.find((l) => l.column === letter);
                if (literal) {
                    dateColumns.push({ index: c, ymd: literal.date, label: `${letter}列(${String(header)})` });
                    continue;
                }
                // ロックの「残合計」列は日付が分からないので、指定されたときだけ取り込む
                const isLockTotal =
                    source.method === 'lock' && letter === 'D' && LOCK_TOTAL_DATE !== null;
                if (isLockTotal) {
                    dateColumns.push({ index: c, ymd: LOCK_TOTAL_DATE!, label: `${letter}列(残合計)` });
                }
            }

            console.log(`[${source.sheet}] ${source.locationName} / ${source.method} — 棚卸 ${dateColumns.length}回分`);

            // --- 行を読む（A 列は結合セルなので直前の値を引き継ぐ）------------
            const rows: { excelCategory: string; excelSpec: string; rowIndex: number }[] = [];
            let lastCategory = '';
            for (let r = 2; r <= ws.rowCount; r++) {
                const a = String(ws.getCell(r, 1).value ?? '').trim();
                const b = String(ws.getCell(r, 2).value ?? '').trim();
                if (a) lastCategory = a;
                const excelCategory = (a || lastCategory).trim();
                if (!excelCategory) continue;
                rows.push({ excelCategory, excelSpec: b || excelCategory, rowIndex: r });
            }

            for (const col of dateColumns) {
                const lines: PendingLine[] = [];
                for (const row of rows) {
                    const mapping = lookupMapping(source.method, row.excelCategory, row.excelSpec);
                    if (!mapping) {
                        unmappedRows.add(`[${source.sheet}] ${row.excelCategory} ${row.excelSpec}`);
                        continue;
                    }
                    const itemId = itemIdByKey.get(dbItemKey(mapping.category, mapping.item));
                    if (!itemId) {
                        missingItems.add(`${mapping.category} / ${mapping.item}`);
                        continue;
                    }
                    const { quantity, note } = parseSheetCellValue(ws.getCell(row.rowIndex, col.index).value);
                    if (quantity === null && note === null) continue; // 空欄は行を作らない
                    lines.push({ materialItemId: itemId, quantity, note });
                }
                if (lines.length === 0) continue;
                pending.push({
                    locationId: location.id,
                    locationName: source.locationName,
                    method: source.method,
                    ymd: col.ymd,
                    columnLabel: col.label,
                    lines,
                });
            }
        }

        // --- 集計を表示 -------------------------------------------------------
        console.log(`\n--- 取り込む棚卸 ${pending.length}件 ---`);
        for (const p of pending) {
            const counted = p.lines.filter((l) => l.quantity !== null).length;
            const noted = p.lines.filter((l) => l.quantity === null && l.note !== null).length;
            console.log(
                `   ${p.ymd}  ${p.locationName}/${p.method}  数量${counted}件` +
                    (noted ? ` / 数値化できず但し書きのみ ${noted}件` : '') +
                    `  (${p.columnLabel})`,
            );
        }

        if (missingItems.size) {
            console.log(`\n⚠ 対応表にあるのに DB に無い品目 ${missingItems.size}件（先に setup-stocktake-master.ts --apply を実行してください）:`);
            console.log(`   ${[...missingItems].join(' , ')}`);
        }
        if (unmappedRows.size) {
            console.log(`\n対応表に無い行（取り込み対象外）${unmappedRows.size}件:`);
            console.log(`   ${[...unmappedRows].join(' , ')}`);
        }
        if (!LOCK_TOTAL_DATE) {
            console.log(
                `\nメモ: ロックシートの D 列「残合計」は日付が分からないので取り込んでいません。` +
                    `\n      日付を決めて取り込むなら --lock-total-date=YYYY-MM-DD を付けてください。`,
            );
        }

        if (!APPLY) {
            console.log('\n書き込みは行っていません。実行するには --apply を付けてください。');
            return;
        }
        if (missingItems.size) {
            console.log('\n中止: DB に無い品目があります。先に setup-stocktake-master.ts --apply を実行してください。');
            process.exitCode = 1;
            return;
        }

        // --- 書き込み ---------------------------------------------------------
        console.log('\n--- 書き込み中 ---');
        let created = 0;
        let skipped = 0;
        for (const p of pending) {
            const date = jstDayStartUtc(p.ymd);
            const exists = await prisma.stocktake.findFirst({
                where: { locationId: p.locationId, scaffoldMethod: p.method, date },
                select: { id: true },
            });
            if (exists) {
                skipped++;
                continue;
            }
            await prisma.stocktake.create({
                data: {
                    locationId: p.locationId,
                    scaffoldMethod: p.method,
                    date,
                    status: STOCKTAKE_STATUS.CONFIRMED,
                    confirmedAt: new Date(),
                    notes: `材料管理表エクセルから取込（${p.columnLabel}）`,
                    createdByName: 'エクセル取込',
                    lines: { create: p.lines },
                },
            });
            created++;
        }
        console.log(`   棚卸を作成: ${created}件${skipped ? `（既にあったので飛ばした: ${skipped}件）` : ''}`);

        // --- 在庫の再計算（任意）----------------------------------------------
        if (!RECOMPUTE_STOCK) {
            console.log(
                '\n在庫（MaterialItem.stockQuantity）には触っていません。' +
                    '\n棚卸から在庫を計算し直すには --recompute-stock を付けてください。',
            );
            return;
        }

        const allItemIds = [...new Set(pending.flatMap((p) => p.lines.map((l) => l.materialItemId)))];
        const targets = await computeStockFromStocktakes(prisma, allItemIds);
        const items = await prisma.materialItem.findMany({
            where: { id: { in: allItemIds } },
            select: { id: true, name: true, stockQuantity: true, category: { select: { name: true } } },
        });
        const inputs = items
            .map((i) => ({
                materialItemId: i.id,
                categoryName: i.category.name,
                itemName: i.name,
                currentQuantity: i.stockQuantity,
                targetQuantity: targets.get(i.id) ?? 0,
                note: '棚卸取込による在庫再計算',
            }))
            .filter((i) => i.targetQuantity !== i.currentQuantity);

        console.log(`\n在庫が変わる品目 ${inputs.length}件:`);
        for (const i of inputs.slice(0, 40)) {
            console.log(`   ${i.categoryName}/${i.itemName}  ${i.currentQuantity} → ${i.targetQuantity}`);
        }
        if (inputs.length > 40) console.log(`   …ほか${inputs.length - 40}件`);

        const result = await prisma.$transaction((tx) => applyInventoryAdjustment(tx, inputs, null), { timeout: 60000 });
        console.log(`   在庫を更新: ${result.appliedCount}件 / 除外: ${result.excludedCount}件`);
        console.log('\n完了しました。');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
