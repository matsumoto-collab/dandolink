/**
 * 支払明細書 PDF（1ページ目＝明細・2ページ目＝出勤簿）を本番の出勤簿から1件作り、破綻がないか検証する。
 *
 * チェック項目:
 *   - 2ページであること
 *   - 1ページ目に「合計金額」「内消費税等」と、合計・内消費税等の数字が出ていること
 *   - 文字が右端を越えないこと（1ページ目は 595 − 36 + 1、2ページ目（出勤簿・余白28pt）は 595 − 28 + 1 まで）
 *   - 日数・合計・内消費税等を表示する（kei が今までの書類と見比べる用）
 *
 * 実行: npx tsx scripts/verify-joyo-statement-pdf.tsx <userId> <year> <month> <単価>
 *   例: npx tsx scripts/verify-joyo-statement-pdf.tsx cxxxxxxxx 2026 8 17000
 *   --out <path> を付けると PDF をそのパスに書き出す（既定は書き出さない）
 * ※ DB は SELECT のみ（出勤簿・ユーザー・自社情報を読むだけ）。対象者（JoyoContractor）は読まない。
 *   宛名は出勤簿の名前＋「様」、住所は空で描く。
 */
import React from 'react';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';
import { JoyoStatementPDF } from '../components/pdf/JoyoStatementPDF';
import { buildAttendanceMonthlyPdfData, type AttendancePdfRecord } from '../utils/attendanceMonthlyData';
import {
    buildDefaultItems,
    buildStatementNo,
    computeJoyoTotals,
    countJoyoDays,
    defaultIssueDate,
    defaultPaymentDate,
    defaultSubject,
} from '../lib/joyoStatement';
// styles.ts（CDNフォント）の後に評価させるため import は最後に置く
import '../lib/pdf/registerServerFonts';

// ローカル .env は本番DB直指しのため、単発スクリプトは接続1本に制限する
const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}

const prisma = new PrismaClient();

const PAGE_WIDTH = 595;
const STATEMENT_MAX_X = PAGE_WIDTH - 36 + 1;
const ATTENDANCE_MAX_X = PAGE_WIDTH - 28 + 1;

async function analyze(buf: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: { text: string; maxX: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        let maxX = 0;
        for (const it of content.items as { str?: string; transform: number[]; width?: number }[]) {
            if (!it.str) continue;
            text += it.str;
            if (it.str.trim()) maxX = Math.max(maxX, Math.round(it.transform[4] + (it.width ?? 0)));
        }
        pages.push({ text, maxX });
    }
    return pages;
}

function usage(): never {
    console.error('使い方: npx tsx scripts/verify-joyo-statement-pdf.tsx <userId> <year> <month> <単価> [--out <path>]');
    process.exit(1);
}

async function main() {
    const args = process.argv.slice(2);
    const outIdx = args.indexOf('--out');
    const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
    const positional = args.filter((a, i) => a !== '--out' && !(outIdx >= 0 && i === outIdx + 1));
    const [userId, yearStr, monthStr, unitPriceStr] = positional;
    if (!userId || !yearStr || !monthStr || !unitPriceStr) usage();
    const year = Number(yearStr);
    const month = Number(monthStr);
    const unitPrice = Number(unitPriceStr);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(unitPrice)) usage();

    const [user, company, rows] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } }),
        prisma.companyInfo.findFirst({ where: { id: 'default' } }),
        prisma.attendanceRecord.findMany({
            where: {
                userId,
                date: { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) },
            },
            orderBy: { date: 'asc' },
        }),
    ]);
    if (!user) {
        console.error(`ユーザーが見つかりません: ${userId}`);
        process.exit(1);
    }
    if (!company) {
        console.error('自社情報（CompanyInfo id=default）が登録されていません');
        process.exit(1);
    }

    const records: AttendancePdfRecord[] = rows.map((r) => ({
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

    // 画面・API と同じ部品で日数 → 明細行 → 合計を出す
    const counts = countJoyoDays(year, month, records);
    const items = buildDefaultItems(counts, unitPrice);
    const { total, tax } = computeJoyoTotals(items);

    const attendance = {
        year,
        month,
        userName: user.displayName,
        ...buildAttendanceMonthlyPdfData(year, month, userId, records),
    };

    const buf = await renderToBuffer(
        <JoyoStatementPDF
            title="支払明細書"
            statementNo={buildStatementNo(year, month, 1)}
            issueDate={defaultIssueDate(year, month)}
            paymentDate={defaultPaymentDate(year, month)}
            year={year}
            month={month}
            subject={defaultSubject(year, month)}
            recipient={{
                name: user.displayName,
                honorific: '様',
                postalCode: null,
                address: null,
                registrationNumber: null,
            }}
            issuer={{
                name: company.name,
                postalCode: company.postalCode,
                address: company.address,
                tel: company.tel,
                fax: company.fax,
                registrationNumber: company.registrationNumber,
            }}
            items={items.map((it) => ({
                name: it.name,
                quantity: it.quantity,
                unit: it.unit,
                unitPrice: it.unitPrice,
                amount: it.amount,
                note: it.note,
            }))}
            total={total}
            tax={tax}
            footerNote={null}
            attendance={attendance}
        />
    );
    if (outPath) {
        fs.writeFileSync(outPath, buf);
        console.log(`PDF を書き出しました: ${outPath}`);
    }

    const pages = await analyze(buf);
    const problems: string[] = [];
    if (pages.length !== 2) problems.push(`ページ数=${pages.length}（期待 2）`);
    // 見出しは字間を空けて描くので pdfjs は「支 払 明 細 書」と返す。空白を落としてから探す
    const first = (pages[0]?.text ?? '').replace(/\s/g, '');
    for (const needed of ['支払明細書', '合計金額', '内消費税等', '支払日', '品名', '常用（全日）']) {
        if (!first.includes(needed)) problems.push(`1ページ目に「${needed}」が見つからない`);
    }
    const totalStr = total.toLocaleString('ja-JP');
    const taxStr = tax.toLocaleString('ja-JP');
    if (!first.includes(totalStr)) problems.push(`1ページ目に合計 ${totalStr} が見つからない`);
    if (!first.includes(taxStr)) problems.push(`1ページ目に内消費税等 ${taxStr} が見つからない`);
    if ((pages[0]?.maxX ?? 0) > STATEMENT_MAX_X) problems.push(`1ページ目 右端はみ出し maxX=${pages[0].maxX}`);
    if (pages[1]) {
        if (!pages[1].text.includes('出勤簿')) problems.push('2ページ目に「出勤簿」が見つからない');
        if (pages[1].maxX > ATTENDANCE_MAX_X) problems.push(`2ページ目 右端はみ出し maxX=${pages[1].maxX}`);
    }

    console.log(`対象: ${user.displayName} ${year}年${month}月分 / 単価 ¥${unitPrice.toLocaleString('ja-JP')}`);
    console.log(
        `日数: 出勤 ${counts.present} / 休日出勤 ${counts.holidayWork} / 夜勤 ${counts.nightShift} / 休日 ${counts.holiday} / 欠勤 ${counts.absent} / 有給 ${counts.paidLeave} / 代休 ${counts.compensatoryHoliday}` +
            (counts.missingDays.length > 0 ? ` / 記録の無い日 ${counts.missingDays.join(',')}` : ''),
    );
    for (const it of items) {
        console.log(`  ${it.name} ${it.quantity}${it.unit} × ¥${it.unitPrice.toLocaleString('ja-JP')} = ¥${it.amount.toLocaleString('ja-JP')}`);
    }
    console.log(`合計（税込）¥${totalStr} / 内消費税等 ¥${taxStr}`);
    console.log(`ページ: ${pages.length} / 1ページ目 maxX=${pages[0]?.maxX ?? '-'} / 2ページ目 maxX=${pages[1]?.maxX ?? '-'}`);

    if (problems.length === 0) {
        console.log('OK');
    } else {
        console.log(`NG  ${problems.join(' / ')}`);
        process.exitCode = 1;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());

export {};
