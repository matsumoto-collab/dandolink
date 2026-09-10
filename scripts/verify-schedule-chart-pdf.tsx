/**
 * 工程表PDF（A3横）の生成確認スクリプト。
 *
 * マイ工程と同じ条件（前後6ヶ月に配置がある案件・担当者で絞り込み）で本番DBから
 * 実データを読み、工程表PDFを出力する。DBへは SELECT のみ。
 *
 * 使い方:
 *   npx tsx -r dotenv/config scripts/verify-schedule-chart-pdf.tsx [出力先.pdf] [担当者名] [件数]
 */
import React from 'react';
import { renderToFile } from '@react-pdf/renderer';
import { PrismaClient } from '@prisma/client';
import { ScheduleChartPDF, PROJECTS_PER_PAGE } from '../components/pdf/ScheduleChartPDF';
import { buildScheduleChart, daysBetween, type ScheduleChartInputProject } from '../lib/scheduleChart';
import '../lib/pdf/registerServerFonts';

const base = process.env.DATABASE_URL ?? '';
const url = base.includes('?') ? `${base}&connection_limit=1` : `${base}?connection_limit=1`;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const outFile = process.argv[2] ?? 'schedule-chart-sample.pdf';
const managerName = process.argv[3] ?? '今井';
const limit = Number(process.argv[4] ?? '8');
/** この月に配置がある案件だけを対象にする（実運用の「今月〜来月の現場を並べる」に合わせる） */
const targetMonth = process.argv[5] ?? new Date().toISOString().slice(0, 7);
/** 案件の期間（最初〜最後の配置日）の上限。0 = 制限なし。日単位目盛の確認に使う */
const maxSpanDays = Number(process.argv[6] ?? '0');

function toYmd(date: Date): string {
    return date.toISOString().split('T')[0];
}

async function main() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);

    const manager = await prisma.user.findFirst({
        where: { displayName: managerName, isActive: true },
        select: { id: true, displayName: true },
    });
    if (!manager) throw new Error(`担当者が見つかりません: ${managerName}`);

    const assignments = await prisma.projectAssignment.findMany({
        where: { date: { gte: start, lte: end } },
        include: {
            projectMaster: {
                select: { id: true, title: true, name: true, honorific: true, createdBy: true, status: true },
            },
        },
        orderBy: { date: 'asc' },
    });

    const constructionTypes = await prisma.constructionType.findMany({
        where: { isActive: true },
        select: { id: true, name: true, color: true },
        orderBy: { sortOrder: 'asc' },
    });

    // マイ工程と同じ絞り込み: 担当者(createdBy) + status=active
    const byProject = new Map<string, ScheduleChartInputProject>();
    for (const a of assignments) {
        const pm = a.projectMaster;
        let createdByIds: string[] = [];
        const raw = pm.createdBy;
        if (typeof raw === 'string') {
            try { createdByIds = JSON.parse(raw); } catch { createdByIds = raw ? [raw] : []; }
        }
        if (!Array.isArray(createdByIds)) createdByIds = [];
        if (!createdByIds.includes(manager.id)) continue;
        if (pm.status !== 'active') continue;

        if (!byProject.has(pm.id)) {
            byProject.set(pm.id, {
                projectMasterId: pm.id,
                label: pm.name ? `${pm.name}${pm.honorific ?? ''}` : pm.title,
                workEntries: [],
            });
        }
        byProject.get(pm.id)!.workEntries.push({
            date: toYmd(a.date instanceof Date ? a.date : new Date(a.date)),
            constructionTypeId: a.constructionType,
        });
    }

    // 実運用（近い時期の現場を5〜10件並べる）に合わせ、対象月に配置がある案件から limit 件
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

    const bars = chart.rows.flatMap(r => r.lines.flatMap(l => l.bars));
    console.log(`担当者: ${manager.displayName} / 案件 ${chart.rows.length}件（1ページ ${PROJECTS_PER_PAGE}件）`);
    console.log(`目盛  : ${chart.scale === 'day' ? '1日ごと' : '5日刻み'} × ${chart.columnCount}列（${chart.months.length}ヶ月）`);
    console.log(`期間  : ${chart.termLabel}`);
    console.log(`バー  : ${bars.length}本 / 範囲外 ${bars.filter(b => b.start < 0 || b.end > chart.columnCount).length}本`);
    console.log(`使用種別: ${chart.usedTypes.map(t => t.name).join('、')}`);
    for (const row of chart.rows) {
        const detail = row.lines
            .map(l => `${l.label}${l.bars.length}`)
            .join(' / ');
        console.log(`  ${row.label}  [${detail}]  ${row.startDate}〜${row.endDate}（${row.workDays}日）`);
    }

    await renderToFile(
        <ScheduleChartPDF
            chart={chart}
            meta={{
                author: manager.displayName,
                createdAt: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
            }}
        />,
        outFile,
    );
    console.log(`\n出力: ${outFile}`);
}

main()
    .catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
