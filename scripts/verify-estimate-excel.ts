/**
 * 見積書 Excel（utils/estimateExcel.ts）の生成確認スクリプト（読み取り専用）。
 *
 * 本番DBの見積書を数件取り、ブックを生成→保存→ExcelJS で読み戻し、
 * 金額セルの数式を簡易評価して 小計・消費税・合計 が DB の値と一致するかを検算する。
 * （ExcelJS は数式を計算しないので、ROUND/SUM/加算/別シート参照だけを解釈する小さな評価器を持つ）
 *
 * 実行: npx tsx -r dotenv/config scripts/verify-estimate-excel.ts [出力先ディレクトリ] [件数] [見積番号の一部]
 */
const base = process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;

const outDir = process.argv[2] ?? '.';
const limit = Number(process.argv[3] ?? '3');
const numberKey = process.argv[4] ?? '';

type Cell = { formula?: string; result?: unknown } | string | number | null | undefined;

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { buildEstimateWorkbook } = await import('../utils/estimateExcel');
    const ExcelJS = (await import('exceljs')).default;
    const fs = await import('node:fs');
    const path = await import('node:path');

    const companyRow = await prisma.companyInfo.findFirst();
    if (!companyRow) throw new Error('会社情報が無い');
    const companyInfo = {
        ...companyRow,
        fax: companyRow.fax ?? undefined,
        email: companyRow.email ?? undefined,
        representativeTitle: companyRow.representativeTitle ?? undefined,
        sealImage: companyRow.sealImage ?? undefined,
        logoImage: companyRow.logoImage ?? undefined,
        licenseNumber: companyRow.licenseNumber ?? undefined,
        registrationNumber: companyRow.registrationNumber ?? undefined,
        contactPerson: companyRow.contactPerson ?? undefined,
        bankAccounts: undefined,
    };

    // カテゴリ（内訳明細書）がある見積を優先して拾う＝数式の分岐を全部通す
    const rows = await prisma.estimate.findMany({
        // 検証なので下書きも含めて直近から拾う（カテゴリ付きの見積を優先して数式の分岐を全部通す）
        where: numberKey ? { estimateNumber: { contains: numberKey } } : {},
        orderBy: { createdAt: 'desc' },
        take: numberKey ? limit : 60,
        select: {
            id: true, projectMasterId: true, customerId: true, estimateNumber: true, title: true, items: true,
            subtotal: true, tax: true, total: true, validUntil: true, status: true, notes: true, location: true,
            costTotal: true, constructionPeriod: true, createdAt: true, updatedAt: true,
        },
    });
    const parsed = rows.map(r => ({ ...r, parsedItems: (() => { try { return JSON.parse(r.items) as unknown[]; } catch { return []; } })() }));
    const withCategory = parsed.filter(r => (r.parsedItems as { isCategory?: boolean }[]).some(i => i.isCategory));
    const picked = numberKey ? parsed : [...withCategory.slice(0, Math.max(1, limit - 1)), ...parsed.filter(r => !withCategory.includes(r))].slice(0, limit);

    let ngTotal = 0;
    for (const row of picked) {
        const pm = row.projectMasterId
            ? await prisma.projectMaster.findUnique({ where: { id: row.projectMasterId }, select: { title: true, location: true, customerName: true } })
            : null;
        const customer = row.customerId ? await prisma.customer.findUnique({ where: { id: row.customerId }, select: { name: true, honorific: true } }) : null;

        const estimate = {
            id: row.id,
            projectId: row.projectMasterId ?? undefined,
            customerId: row.customerId ?? undefined,
            estimateNumber: row.estimateNumber,
            title: row.title,
            items: row.parsedItems as never,
            subtotal: Number(row.subtotal), tax: Number(row.tax), total: Number(row.total),
            validUntil: row.validUntil, status: row.status as never,
            notes: row.notes ?? undefined, location: row.location ?? undefined,
            costTotal: row.costTotal, constructionPeriod: row.constructionPeriod,
            createdAt: row.createdAt, updatedAt: row.updatedAt,
        };
        const project = {
            id: row.projectMasterId ?? '', title: pm?.title ?? row.title, startDate: new Date(), category: 'construction' as const, color: '#3B82F6',
            customer: customer?.name ?? pm?.customerName ?? '', customerHonorific: customer?.honorific ?? '御中',
            location: pm?.location ?? '', createdAt: new Date(), updatedAt: new Date(),
        };

        const { workbook, coverTotals, taxAsValue } = await buildEstimateWorkbook(estimate as never, project as never, companyInfo as never, { includeDetails: true, creatorName: '検証' });
        const buffer = await workbook.xlsx.writeBuffer();
        const file = path.join(outDir, `見積書_${row.estimateNumber.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
        fs.writeFileSync(file, Buffer.from(buffer));

        // ---- 読み戻して数式を評価 ----
        const rb = new ExcelJS.Workbook();
        await rb.xlsx.load(fs.readFileSync(file) as unknown as ArrayBuffer);
        const cover = rb.getWorksheet('御見積書');
        if (!cover) throw new Error('シート「御見積書」が無い');

        const cache = new Map<string, number>();
        const evalRef = (sheetName: string, ref: string): number => {
            const key = `${sheetName}!${ref}`;
            if (cache.has(key)) return cache.get(key)!;
            const ws = rb.getWorksheet(sheetName);
            if (!ws) throw new Error(`シートが無い: ${sheetName}`);
            const cell = ws.getCell(ref).value as Cell;
            let v = 0;
            if (cell && typeof cell === 'object' && 'formula' in cell && cell.formula) v = evalFormula(sheetName, cell.formula);
            else if (typeof cell === 'number') v = cell;
            else if (typeof cell === 'string' && cell.trim() !== '' && !Number.isNaN(Number(cell))) v = Number(cell);
            cache.set(key, v);
            return v;
        };
        const evalFormula = (sheetName: string, f: string): number => {
            const s = f.trim();
            let m: RegExpExecArray | null;
            if ((m = /^ROUND\(([A-Z]+\d+)\*([A-Z]+\d+),0\)$/.exec(s))) return Math.round(evalRef(sheetName, m[1]) * evalRef(sheetName, m[2]));
            if ((m = /^ROUNDDOWN\(\((.*)\)\*([\d.]+),0\)$/.exec(s))) return Math.floor(evalFormula(sheetName, m[1]) * Number(m[2]));
            if ((m = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(s))) {
                let sum = 0;
                for (let r = Number(m[2]); r <= Number(m[4]); r += 1) sum += evalRef(sheetName, `${m[1]}${r}`);
                return sum;
            }
            if ((m = /^'([^']+)'!([A-Z]+\d+)$/.exec(s))) return evalRef(m[1], m[2]);
            if (/^[A-Z]+\d+(\+[A-Z]+\d+)*$/.test(s)) return s.split('+').reduce((acc, ref) => acc + evalRef(sheetName, ref), 0);
            if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
            throw new Error(`評価できない数式: ${f}`);
        };

        const got = {
            subtotal: evalRef('御見積書', coverTotals.subtotalCell),
            tax: evalRef('御見積書', coverTotals.taxCell),
            total: evalRef('御見積書', coverTotals.totalCell),
            big: evalRef('御見積書', 'C9'),
        };
        const okSub = got.subtotal === estimate.subtotal;
        const okTax = got.tax === estimate.tax;
        const okTotal = got.total === estimate.total && got.big === estimate.total;
        const ng = [okSub, okTax, okTotal].filter(x => !x).length;
        ngTotal += ng;

        const sheets = rb.worksheets.map(w => w.name).join(' / ');
        const itemCount = (row.parsedItems as { isCategory?: boolean; children?: unknown[] }[]).reduce((n, i) => n + 1 + (i.children?.length ?? 0), 0);
        console.log('='.repeat(90));
        console.log(`${row.estimateNumber}  ${row.title}`);
        console.log(`  シート: ${sheets}  / 項目 ${itemCount}  / 消費税は${taxAsValue ? '値' : '数式'}`);
        console.log(`  宛名 A4: "${cover.getCell('A4').value}"   件名 B13: "${cover.getCell('B13').value}"`);
        console.log(`  小計   ${got.subtotal.toLocaleString().padStart(12)}  DB ${estimate.subtotal.toLocaleString().padStart(12)}  ${okSub ? '一致' : 'NG'}`);
        console.log(`  消費税 ${got.tax.toLocaleString().padStart(12)}  DB ${estimate.tax.toLocaleString().padStart(12)}  ${okTax ? '一致' : 'NG'}`);
        console.log(`  合計   ${got.total.toLocaleString().padStart(12)}  DB ${estimate.total.toLocaleString().padStart(12)}  ${okTotal ? '一致' : 'NG'}（上部の合計金額セル C9 も ${got.big === estimate.total ? '一致' : 'NG'}）`);
        console.log(`  出力: ${file}`);
    }
    console.log(`\n検算 NG 件数: ${ngTotal}`);
    if (ngTotal > 0) process.exitCode = 1;
}

async function run() {
    try { await main(); } catch (e) { console.error(e); process.exitCode = 1; }
    const { prisma } = await import('../lib/prisma');
    await prisma.$disconnect();
}
run();

export {};
