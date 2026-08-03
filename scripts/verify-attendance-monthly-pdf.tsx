/**
 * 個人別月次出勤簿PDFを本番データで1枚生成し、破綻がないか検証する。
 *
 * チェック項目:
 *   - 1ページに収まっているか（紙の出勤簿はA4縦1枚が前提）
 *   - タイトル・表見出し・合計時間行・サマリー見出しが全て描画されているか
 *   - 1〜月末までの日番号が欠落なく出ているか
 *   - テキストが右端（595 − padding 28）を越えていないか
 *
 * 実行: npx tsx scripts/verify-attendance-monthly-pdf.tsx [検証する人月数]
 * ※ DB は SELECT のみ。
 */
import React from 'react';
import { PrismaClient } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';
import { AttendanceMonthlyPDF } from '../components/pdf/AttendanceMonthlyPDF';
import { buildAttendanceMonthlyPdfData, type AttendancePdfRecord } from '../utils/attendanceMonthlyPdf';
// styles.ts（CDNフォント）の後に評価させるため import は最後に置く
import '../lib/pdf/registerServerFonts';

const prisma = new PrismaClient();

async function analyze(buf: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: { text: string; dayNums: number[]; maxX: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        const dayNums: number[] = [];
        let maxX = 0;
        for (const it of content.items as any[]) {
            if (!it.str) continue;
            text += it.str;
            if (it.str.trim()) maxX = Math.max(maxX, Math.round(it.transform[4] + (it.width ?? 0)));
            // 日付列（左端28pt幅）の数字
            if (/^\d{1,2}$/.test(it.str.trim()) && it.transform[4] < 56) dayNums.push(Number(it.str.trim()));
        }
        pages.push({ text, dayNums, maxX });
    }
    return pages;
}

async function main() {
    const limit = process.argv[2] ? Number(process.argv[2]) : 10;

    const records = await prisma.attendanceRecord.findMany({
        orderBy: { date: 'desc' },
        take: 4000,
    });
    if (records.length === 0) {
        console.log('出勤簿レコードがありません');
        return;
    }

    // 「ユーザー × 月」でまとめ、件数の多い順に検証
    const buckets = new Map<string, typeof records>();
    for (const r of records) {
        const d = r.date;
        const key = `${r.userId}::${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
        const arr = buckets.get(key) ?? [];
        arr.push(r);
        buckets.set(key, arr);
    }
    const targets = Array.from(buckets.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, limit);

    const users = await prisma.user.findMany({ select: { id: true, displayName: true } });
    const nameMap = new Map(users.map((u) => [u.id, u.displayName]));

    let ng = 0;
    for (const [key, rows] of targets) {
        const [userId, ym] = key.split('::');
        const [year, month] = ym.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const userName = nameMap.get(userId) ?? '(不明)';

        const pdfRecords: AttendancePdfRecord[] = rows.map((r) => ({
            userId: r.userId,
            date: r.date.toISOString(),
            status: r.status,
            earlyStartMinutes: r.earlyStartMinutes,
            morningLoadingMinutes: r.morningLoadingMinutes,
            overtimeMinutes: r.overtimeMinutes,
            eveningLoadingMinutes: r.eveningLoadingMinutes,
            earlyEndTime: r.earlyEndTime,
            note: r.note,
        }));

        const { days, totals, summary } = buildAttendanceMonthlyPdfData(year, month, userId, pdfRecords);
        const buf = await renderToBuffer(
            <AttendanceMonthlyPDF
                year={year}
                month={month}
                userName={userName}
                days={days}
                totals={totals}
                summary={summary}
            />
        );
        const pages = await analyze(buf);

        const problems: string[] = [];
        if (pages.length !== 1) problems.push(`ページ数=${pages.length}（1枚に収まっていない）`);
        const text = pages.map((p) => p.text).join('');
        for (const needed of ['出勤簿', '氏名', '所定労働時間', '区分', '現場開始', '差時間', '合計時間', '時間外合計']) {
            if (!text.includes(needed)) problems.push(`「${needed}」が見つからない`);
        }
        const seen = new Set(pages.flatMap((p) => p.dayNums));
        const missing: number[] = [];
        for (let d = 1; d <= daysInMonth; d++) if (!seen.has(d)) missing.push(d);
        if (missing.length > 0) problems.push(`日番号欠落: ${missing.join(',')}`);
        const maxX = Math.max(...pages.map((p) => p.maxX));
        if (maxX > 595 - 28 + 1) problems.push(`右端はみ出し maxX=${maxX}`);

        const label = `${userName} ${year}/${month} (${rows.length}件, ${daysInMonth}日)`;
        if (problems.length === 0) {
            console.log(`OK  ${label} — 1ページ / 出勤${summary.presentDays} 有給${summary.paidLeaveDays} 差時間計${totals.diff}`);
        } else {
            ng++;
            console.log(`NG  ${label} — ${problems.join(' / ')}`);
        }
    }
    console.log(`\n検証 ${targets.length} 件 / NG ${ng} 件`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
