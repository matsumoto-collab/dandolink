/**
 * 工程表 Excel（utils/scheduleChartExcel.ts）の生成確認スクリプト。
 *
 * verify-schedule-chart-pdf.tsx と同じ条件で本番DBから実データを読み（SELECT のみ）、
 * ブックを生成して .xlsx に保存し、ExcelJS で読み戻して構造を検査する。
 *
 * 実行: npx tsx -r dotenv/config scripts/verify-schedule-chart-excel.ts [出力先.xlsx] [担当者名] [件数] [対象月] [期間上限日]
 */
const base = process.env.DATABASE_URL ?? '';
process.env.DATABASE_URL = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;

const outFile = process.argv[2] ?? 'schedule-chart-sample.xlsx';
const managerName = process.argv[3] ?? '今井';
const limit = Number(process.argv[4] ?? '6');
const targetMonth = process.argv[5] ?? new Date().toISOString().slice(0, 7);
const maxSpanDays = Number(process.argv[6] ?? '0');

function toYmd(date: Date): string {
    return date.toISOString().split('T')[0];
}

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { buildScheduleChart, daysBetween } = await import('../lib/scheduleChart');
    const { buildScheduleChartWorkbook } = await import('../utils/scheduleChartExcel');
    const ExcelJS = (await import('exceljs')).default;
    const fs = await import('node:fs');

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);

    const manager = await prisma.user.findFirst({ where: { displayName: managerName, isActive: true }, select: { id: true, displayName: true } });
    if (!manager) throw new Error(`担当者が見つかりません: ${managerName}`);

    const assignments = await prisma.projectAssignment.findMany({
        where: { date: { gte: start, lte: end } },
        include: { projectMaster: { select: { id: true, title: true, name: true, honorific: true, createdBy: true, status: true } } },
        orderBy: { date: 'asc' },
    });
    const constructionTypes = await prisma.constructionType.findMany({
        where: { isActive: true }, select: { id: true, name: true, color: true }, orderBy: { sortOrder: 'asc' },
    });

    const byProject = new Map<string, { projectMasterId: string; label: string; workEntries: { date: string; constructionTypeId: string | null }[] }>();
    for (const a of assignments) {
        const pm = a.projectMaster;
        let createdByIds: string[] = [];
        if (typeof pm.createdBy === 'string') { try { createdByIds = JSON.parse(pm.createdBy); } catch { createdByIds = pm.createdBy ? [pm.createdBy] : []; } }
        if (!Array.isArray(createdByIds) || !createdByIds.includes(manager.id) || pm.status !== 'active') continue;
        if (!byProject.has(pm.id)) byProject.set(pm.id, { projectMasterId: pm.id, label: pm.name ? `${pm.name}${pm.honorific ?? ''}` : pm.title, workEntries: [] });
        byProject.get(pm.id)!.workEntries.push({ date: toYmd(a.date), constructionTypeId: a.constructionType });
    }
    const projects = Array.from(byProject.values())
        .filter(p => p.workEntries.some(e => e.date.startsWith(targetMonth)))
        .filter(p => {
            if (maxSpanDays <= 0) return true;
            const dates = p.workEntries.map(e => e.date).sort();
            return daysBetween(dates[0], dates[dates.length - 1]) <= maxSpanDays;
        })
        .sort((a, b) => (a.workEntries[0]?.date ?? '').localeCompare(b.workEntries[0]?.date ?? ''))
        .slice(0, limit);

    const chart = buildScheduleChart(projects, constructionTypes);
    const wb = await buildScheduleChartWorkbook(chart, {
        author: manager.displayName,
        term: chart.termLabel,
        createdAt: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    });
    const buffer = await wb.xlsx.writeBuffer();
    fs.writeFileSync(outFile, Buffer.from(buffer));

    console.log(`案件 ${chart.rows.length}件 / 目盛 ${chart.scale === 'day' ? '1日ごと' : '5日刻み'} × ${chart.columnCount}列 / 期間 ${chart.termLabel}`);
    console.log(`出力: ${outFile}（${Buffer.from(buffer).length.toLocaleString()} bytes）`);

    // ---- 読み戻して検査 ----
    const rb = new ExcelJS.Workbook();
    await rb.xlsx.load(fs.readFileSync(outFile) as unknown as ArrayBuffer);
    const ws = rb.getWorksheet('工程表');
    if (!ws) throw new Error('シート「工程表」が無い');
    const GRID_FIRST = 3;
    const remarkCol = GRID_FIRST + chart.columnCount;

    console.log(`\nシート: ${ws.name} / 行数 ${ws.rowCount} / 列数 ${ws.columnCount} / 印刷 ${ws.pageSetup.orientation} paperSize=${ws.pageSetup.paperSize} fitToWidth=${ws.pageSetup.fitToWidth}`);
    console.log(`A1: "${ws.getCell(1, 1).value}"  A2: "${ws.getCell(2, 1).value}"  B4: "${ws.getCell(4, 2).value}"`);
    console.log(`A6: "${ws.getCell(6, 1).value}"  B6: "${ws.getCell(6, 2).value}"  ${ws.getColumn(remarkCol).letter}6: "${ws.getCell(6, remarkCol).value}"`);

    // 月見出し・日付
    const months = chart.months.map(m => m.label);
    const dayLabels: string[] = [];
    for (let c = GRID_FIRST; c < GRID_FIRST + Math.min(12, chart.columnCount); c += 1) dayLabels.push(String(ws.getCell(7, c).value));
    console.log(`月見出し: ${months.join(' / ')}`);
    console.log(`日付の先頭12列: ${dayLabels.join(' ')}`);

    // 案件行: 現場名（3行結合）・工程名・塗られたセル数をバー数と突合
    let ok = 0;
    let ng = 0;
    chart.rows.forEach((project, i) => {
        const top = 8 + i * 3;
        const name = String(ws.getCell(top, 1).value ?? '');
        const types = [0, 1, 2].map(k => String(ws.getCell(top + k, 2).value ?? ''));
        const merged = ws.model.merges?.some(m => m === `A${top}:A${top + 2}`) ?? false;
        let painted = 0;
        let expected = 0;
        project.lines.forEach((line, k) => {
            for (let c = GRID_FIRST; c < remarkCol; c += 1) {
                const fill = ws.getCell(top + k, c).fill as { fgColor?: { argb?: string } } | undefined;
                if (fill?.fgColor?.argb && fill.fgColor.argb !== 'FFFFFFFF') painted += 1;
            }
            for (const bar of line.bars) expected += Math.min(chart.columnCount, Math.ceil(bar.end)) - Math.max(0, Math.floor(bar.start));
        });
        const good = name === project.label && types.join('/') === '組立/その他/解体' && merged && painted === expected;
        if (good) ok += 1; else ng += 1;
        console.log(`  ${good ? 'OK' : 'NG'} ${name}  [${types.join('/')}] 結合=${merged} 塗り=${painted}/${expected}`);
    });
    console.log(`\n案件行の検査: OK ${ok} / NG ${ng}`);
    const remarksRow = 8 + chart.rows.length * 3;
    console.log(`備考欄 A${remarksRow}: "${ws.getCell(remarksRow, 1).value}"  印刷範囲: ${ws.pageSetup.printArea}`);
    if (ng > 0) process.exitCode = 1;
}

async function run() {
    try { await main(); } catch (e) { console.error(e); process.exitCode = 1; }
    const { prisma } = await import('../lib/prisma');
    await prisma.$disconnect();
}
run();

export {};
