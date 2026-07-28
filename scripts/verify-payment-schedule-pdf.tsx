/**
 * 支払予定表PDFのページ分割を本番データで検証する。
 *
 * 旧実装は ROWS_PER_PAGE（固定22行）で Page を分けていたため、口座名義の折り返しで
 * 行高が可変になると1ページに収まらず、react-pdf の自動改ページで
 * 「ヘッダーもページ番号も無いページ」が挟まっていた（kei報告 2026-07-28）。
 *
 * チェック項目（全支払日ぶん）:
 *   - 全ページにタイトル「支払予定表」とテーブル見出し「入金先」があるか
 *   - 複数ページのとき全ページに「n / m ページ」があり、m が実ページ数と一致するか
 *   - No. が 1..件数 まで欠落・重複なく出ているか
 *
 * 実行: npx tsx scripts/verify-payment-schedule-pdf.tsx [検証する支払日数]
 * ※ DB は SELECT のみ。
 */
import React from 'react';
import { PrismaClient } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';
import { PaymentSchedulePDF } from '../components/pdf/PaymentSchedulePDF';
import '../lib/pdf/registerServerFonts';
import type { PaymentSchedule } from '../types/paymentSchedule';

const prisma = new PrismaClient();

async function analyze(buf: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: { text: string; nos: number[]; lowest: number; maxX: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        const nos: number[] = [];
        let lowest = Infinity;
        let maxX = 0;
        for (const it of content.items as any[]) {
            if (!it.str) continue;
            text += it.str;
            const y = Math.round(it.transform[5]);
            if (it.str.trim()) {
                lowest = Math.min(lowest, y);
                // テキストの右端（横方向の溢れ検出用）
                maxX = Math.max(maxX, Math.round(it.transform[4] + (it.width ?? 0)));
            }
            // No.列（左端）の数字
            if (/^\d+$/.test(it.str.trim()) && it.transform[4] < 45) nos.push(Number(it.str.trim()));
        }
        pages.push({ text, nos, lowest: lowest === Infinity ? -1 : lowest, maxX });
    }
    return pages;
}

async function main() {
    const limitLists = process.argv[2] ? Number(process.argv[2]) : 20;
    // 実運用の出力単位は「支払日 × listKey」（同じ支払日に複数リストを作れる）
    const grouped = await prisma.paymentSchedule.groupBy({
        by: ['paymentDate', 'listKey'],
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: limitLists,
    });
    console.log(`件数の多い支払リスト ${grouped.length}件ぶんを検証`);

    let ng = 0;
    for (const g of grouped) {
        const rows = await prisma.paymentSchedule.findMany({
            where: { paymentDate: g.paymentDate, listKey: g.listKey },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const items = rows.map((r) => ({
            ...r,
            paymentDate: r.paymentDate.toISOString(),
            amount: Number(r.amount),
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            dueDate: r.dueDate?.toISOString() ?? null,
            paidAt: r.paidAt?.toISOString() ?? null,
        })) as unknown as PaymentSchedule[];
        const dateStr = g.paymentDate.toISOString().slice(0, 10);

        const buf = Buffer.from(
            await renderToBuffer(<PaymentSchedulePDF items={items} paymentDate={dateStr} />),
        );
        const pages = await analyze(buf);

        const problems: string[] = [];
        pages.forEach((p, i) => {
            if (!p.text.includes('支払予定表')) problems.push(`p${i + 1}にタイトルなし`);
            if (!p.text.includes('入金先')) problems.push(`p${i + 1}に見出しなし`);
            if (pages.length > 1) {
                const expected = `${i + 1}/${pages.length}ページ`;
                if (!p.text.replace(/\s/g, '').includes(expected)) {
                    problems.push(`p${i + 1}のページ番号が「${expected}」でない`);
                }
            }
        });
        const allNos = pages.flatMap((p) => p.nos).sort((a, b) => a - b);
        const expectedNos = items.map((_, i) => i + 1);
        if (JSON.stringify(allNos) !== JSON.stringify(expectedNos)) {
            problems.push(`No.の欠落/重複（出力${allNos.length}件 / データ${items.length}件）`);
        }

        // A4横(842pt) − 左右padding24 = 右端 818pt。テキストがこれを超えていたら横溢れ。
        const maxX = Math.max(...pages.map((p) => p.maxX));
        if (maxX > 818) problems.push(`横溢れ（テキスト右端 ${maxX}pt > 818pt）`);

        const flag = problems.length ? '❌' : '  ';
        if (problems.length) ng++;
        console.log(
            `${flag} ${dateStr} ${items.length}件 → ${pages.length}ページ（各${pages.map((p) => p.nos.length).join('/')}行）右端${maxX}pt${problems.length ? ' :: ' + problems.join(' / ') : ''}`,
        );
    }
    console.log(ng === 0 ? '✅ 全支払日でヘッダー・ページ番号・行の欠落なし' : `❌ 問題あり: ${ng}日ぶん`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
