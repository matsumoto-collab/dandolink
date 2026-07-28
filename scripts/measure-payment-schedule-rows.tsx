/**
 * 支払予定表PDFの「1行あたりの実高さ」を実測するスクリプト（較正用）。
 *
 * PaymentSchedulePDF は ROWS_PER_PAGE（固定行数）でページを分けているが、
 * 口座名義などが折り返して行の高さが可変なため、実際には入り切らず
 * react-pdf の自動改ページでヘッダの無い中途半端なページが生まれていた（kei報告 2026-07-28）。
 * 高さベースの分割に直すにあたり、行高の見積もり式を実測で較正する。
 *
 * 実行: npx tsx scripts/measure-payment-schedule-rows.tsx [YYYY-MM-DD]
 * ※ DB は SELECT のみ。
 */
import React from 'react';
import { PrismaClient } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';
import { PaymentSchedulePDF } from '../components/pdf/PaymentSchedulePDF';
import '../lib/pdf/registerServerFonts';
import type { PaymentSchedule } from '../types/paymentSchedule';

const prisma = new PrismaClient();

function textUnits(s = ''): number {
    let u = 0;
    for (const ch of s) u += /[\x00-\xff｡-ﾟ]/.test(ch) ? 0.6 : 1;
    return u;
}

/** 内寸 width にフォント fs で何行に折り返すかの概算 */
function lines(text: string | null | undefined, width: number, fs: number): number {
    const u = textUnits(text || '');
    if (u <= 0) return 1;
    return Math.max(1, Math.ceil((u * fs) / width));
}

async function main() {
    const dateArg = process.argv[2] || '2026-07-31';
    const start = new Date(`${dateArg}T00:00:00.000Z`);
    const end = new Date(`${dateArg}T23:59:59.999Z`);
    const rows = await prisma.paymentSchedule.findMany({
        where: { paymentDate: { gte: start, lte: end } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    console.log(`${dateArg} の支払予定 ${rows.length}件`);
    if (rows.length === 0) return;

    const items = rows.map((r) => ({
        ...r,
        paymentDate: r.paymentDate.toISOString(),
        amount: Number(r.amount),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        dueDate: r.dueDate?.toISOString() ?? null,
        paidAt: r.paidAt?.toISOString() ?? null,
    })) as unknown as PaymentSchedule[];

    const buf = Buffer.from(
        await renderToBuffer(<PaymentSchedulePDF items={items} paymentDate={dateArg} />),
    );

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    console.log(`PDFページ数=${doc.numPages}\n`);

    // No.列（x が左端）のテキスト位置＝各行の中心。連続する行の差が行高。
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const noCells = (content.items as any[])
            .filter((it) => it.str && /^\d+$/.test(it.str.trim()) && it.transform[4] < 45)
            .map((it) => ({ no: Number(it.str.trim()), y: Math.round(it.transform[5]) }))
            .sort((a, b) => b.y - a.y);
        console.log(`--- page ${p}: ${noCells.length}行 (No.${noCells[0]?.no}〜${noCells[noCells.length - 1]?.no})`);
        for (let i = 0; i < noCells.length; i++) {
            const cur = noCells[i];
            const h = i + 1 < noCells.length ? cur.y - noCells[i + 1].y : null;
            const item = items[cur.no - 1];
            if (!item) continue;
            const est = {
                payee: lines(item.payeeName, 165 - 6 - 4 - 0.5, 8.5),
                bank: lines(item.bankName, 75 - 5 - 4 - 0.5, 8.5),
                branch: lines(item.branchName, 65 - 5 - 4 - 0.5, 8.5),
                holder: lines(item.accountHolder, 110 - 4 - 4 - 0.5, 8.5),
            };
            const maxLines = Math.max(est.payee, est.bank, est.branch, est.holder);
            console.log(
                `  No.${String(cur.no).padStart(2)} y=${String(cur.y).padStart(3)} 実高=${h ?? '-'}  推定行数=${maxLines} (payee${est.payee}/bank${est.bank}/branch${est.branch}/holder${est.holder})  ${item.payeeName} | ${item.accountHolder ?? ''}`,
            );
        }
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
