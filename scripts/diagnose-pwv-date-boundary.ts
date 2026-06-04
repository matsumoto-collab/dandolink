/**
 * 協力業者出来高 月境界ズレ診断（読み取り専用）
 * 5月を表示しているのに 6/1 や 4/30 が混入する問題の原因確認。
 *
 * 使い方:
 *   npx tsx scripts/diagnose-pwv-date-boundary.ts [year] [month]
 *   （省略時 2026/5）
 *
 * 出力:
 *   - 現行クエリ範囲（UTC midnight 基準）で取得した ProjectAssignment の
 *     生 date(ISO) と jstDateKey をリスト。境界(月初/月末/翌月初)を強調。
 *   - 同様に PartnerWorkVolume(@db.Date) 保存行。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function jstDateKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

async function main() {
    const y = Number(process.argv[2] ?? 2026);
    const m = Number(process.argv[3] ?? 5);

    // 現行コードと同じ UTC midnight 範囲
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    console.log(`\n=== 対象 ${y}/${m} ===`);
    console.log(`現行クエリ範囲(UTC): gte=${start.toISOString()} lt=${end.toISOString()}`);

    // ---- ProjectAssignment ----
    const assignments = await prisma.projectAssignment.findMany({
        where: { date: { gte: start, lt: end } },
        select: { id: true, date: true },
        orderBy: [{ date: 'asc' }],
    });
    // 生 date の「時刻部分(UTC)」分布を集計 → 00:00Z(=UTC midnight) か 15:00Z(=JST midnight) か
    const timeDist = new Map<string, number>();
    const jstKeyDist = new Map<string, number>();
    for (const a of assignments) {
        const iso = a.date.toISOString();
        const t = iso.slice(11, 19);
        timeDist.set(t, (timeDist.get(t) ?? 0) + 1);
        const k = jstDateKey(a.date);
        jstKeyDist.set(k, (jstKeyDist.get(k) ?? 0) + 1);
    }
    console.log(`\n[ProjectAssignment] 件数=${assignments.length}`);
    console.log('  生 date の UTC時刻分布:');
    for (const [t, c] of Array.from(timeDist.entries()).sort()) {
        console.log(`    ${t}Z  -> ${c}件`);
    }
    console.log('  jstDateKey(表示日) の分布（境界に注目）:');
    for (const [k, c] of Array.from(jstKeyDist.entries()).sort()) {
        const inMonth = k.startsWith(`${y}-${String(m).padStart(2, '0')}`);
        const flag = inMonth ? '' : '  <<< 月外！';
        console.log(`    ${k}  -> ${c}件${flag}`);
    }
    // 月外サンプルの生値
    const outside = assignments.filter((a) => !jstDateKey(a.date).startsWith(`${y}-${String(m).padStart(2, '0')}`));
    if (outside.length) {
        console.log('  月外行の生 date サンプル(最大8):');
        for (const a of outside.slice(0, 8)) {
            console.log(`    raw=${a.date.toISOString()}  jst=${jstDateKey(a.date)}  id=${a.id}`);
        }
    }

    // ---- PartnerWorkVolume(@db.Date) ----
    const saved = await prisma.partnerWorkVolume.findMany({
        where: { date: { gte: start, lt: end } },
        select: { id: true, date: true, partnerCompanyId: true, deletedAt: true },
        orderBy: [{ date: 'asc' }],
    });
    const savedTimeDist = new Map<string, number>();
    const savedJstDist = new Map<string, number>();
    for (const r of saved) {
        savedTimeDist.set(r.date.toISOString().slice(11, 19), (savedTimeDist.get(r.date.toISOString().slice(11, 19)) ?? 0) + 1);
        const k = jstDateKey(r.date);
        savedJstDist.set(k, (savedJstDist.get(k) ?? 0) + 1);
    }
    console.log(`\n[PartnerWorkVolume] 件数=${saved.length}`);
    console.log('  生 date の UTC時刻分布:');
    for (const [t, c] of Array.from(savedTimeDist.entries()).sort()) {
        console.log(`    ${t}Z  -> ${c}件`);
    }
    console.log('  jstDateKey(表示日) の分布:');
    for (const [k, c] of Array.from(savedJstDist.entries()).sort()) {
        const inMonth = k.startsWith(`${y}-${String(m).padStart(2, '0')}`);
        const flag = inMonth ? '' : '  <<< 月外！';
        console.log(`    ${k}  -> ${c}件${flag}`);
    }

    // 参考: JST境界で引いたらどうなるか（start/end を 9h 戻す）
    const startJst = new Date(start.getTime() - 9 * 3600 * 1000);
    const endJst = new Date(end.getTime() - 9 * 3600 * 1000);
    const aJstRows = await prisma.projectAssignment.findMany({
        where: { date: { gte: startJst, lt: endJst } },
        select: { date: true },
    });
    console.log(`\n[修正後] JST境界(gte=${startJst.toISOString()} lt=${endJst.toISOString()}) での ProjectAssignment 件数=${aJstRows.length}`);
    const fixedDist = new Map<string, number>();
    for (const r of aJstRows) {
        const k = jstDateKey(r.date);
        fixedDist.set(k, (fixedDist.get(k) ?? 0) + 1);
    }
    let outCount = 0;
    for (const [k, c] of Array.from(fixedDist.entries()).sort()) {
        if (!k.startsWith(`${y}-${String(m).padStart(2, '0')}`)) {
            console.log(`    ${k} -> ${c}件  <<< 月外！（修正後も残存）`);
            outCount += c;
        }
    }
    console.log(`  修正後の月外行: ${outCount}件 ${outCount === 0 ? '✓ 解消' : '✗ 残あり'}`);
    console.log(`  表示日レンジ: ${Array.from(fixedDist.keys()).sort()[0]} 〜 ${Array.from(fixedDist.keys()).sort().slice(-1)[0]}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
