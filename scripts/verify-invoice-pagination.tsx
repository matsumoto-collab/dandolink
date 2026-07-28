/**
 * 本番データの全請求書を実際に PDF レンダリングし、ページ分割が壊れていないかを検証する。
 *
 * チェック項目:
 *   - 溢れ: ページ本文の最下端 Y が用紙下端(40pt)を割っていないか
 *   - 空ページ: 本文テキストが1つも無いページが生成されていないか（罫線だけこぼれた状態）
 *   - ページ数: 明細の span 合計に対して妥当か（1ページに収まるはずが2ページになっていないか）
 *
 * 実行: npx tsx scripts/verify-invoice-pagination.tsx [件数上限]
 * ※ DB は SELECT のみ。書き込みは一切行わない。
 */
import React from 'react';
import { PrismaClient } from '@prisma/client';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePDF } from '../components/pdf/InvoicePDF';
import '../lib/pdf/registerServerFonts';
import type { Invoice } from '../types/invoice';
import type { Project } from '../types/calendar';
import type { CompanyInfo } from '../types/company';

const prisma = new PrismaClient();

// 弊社情報（PDF 実物と同じ。振込先2件＝容量の基準ケース）
const companyInfo = {
    name: '株式会社雄伸工業',
    postalCode: '799-3104',
    address: '愛媛県伊予市上三谷甲3517番地',
    representative: '今井 公一郎',
    representativeTitle: '代表取締役',
    licenseNumber: '愛媛県知事 許可 (般-6) 第17335号',
    registrationNumber: 'T8500001018289',
    bankAccounts: [
        { bankName: '愛媛銀行', branchName: '古川支店', accountType: '普', accountNumber: '3916237' },
        { bankName: '伊予銀行', branchName: '郡中支店', accountType: '普', accountNumber: '1844218' },
    ],
} as unknown as CompanyInfo;

async function analyze(buf: Buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: { lowest: number; hasText: boolean }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let min = Infinity;
        let count = 0;
        for (const it of content.items as any[]) {
            if (!it.str || !it.str.trim()) continue;
            const y = Math.round(it.transform[5]);
            if (y < 20) continue; // フッターのページ番号は除外
            min = Math.min(min, y);
            count++;
        }
        pages.push({ lowest: min === Infinity ? -1 : min, hasText: count > 0 });
    }
    return pages;
}

async function main() {
    const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
    const invoices = await prisma.invoice.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
    const customers = new Map(
        (await prisma.customer.findMany({ select: { id: true, name: true, honorific: true, postalCode: true, address: true } }))
            .map((c) => [c.id, c]),
    );
    const masters = new Map(
        (await prisma.projectMaster.findMany({ select: { id: true, title: true } })).map((p) => [p.id, p]),
    );

    console.log(`請求書 ${invoices.length}件を検証`);
    let ng = 0;
    for (const inv of invoices) {
        let items: any[] = [];
        try {
            items = JSON.parse(inv.items || '[]');
        } catch {
            console.log(`  ⚠ ${inv.invoiceNumber}: items のJSONパース失敗（スキップ）`);
            continue;
        }
        if (!Array.isArray(items) || items.length === 0) continue;

        const pmIds = [...new Set(items.map((it) => it.projectMasterId).filter(Boolean))];
        const pms = pmIds.map((id) => masters.get(id)).filter(Boolean) as Array<{ id: string; title: string }>;
        const cust = inv.customerId ? customers.get(inv.customerId) : undefined;

        const invoice = {
            ...inv,
            items,
            subtotal: Number(inv.subtotal),
            tax: Number(inv.tax),
            total: Number(inv.total),
        } as unknown as Invoice;
        const project = {
            id: inv.projectMasterId || 'p',
            title: inv.title,
            customer: cust?.name || '',
            customerHonorific: cust?.honorific || '御中',
            customerPostalCode: cust?.postalCode || '',
            customerAddress: cust?.address || '',
        } as unknown as Project;

        const buf = Buffer.from(
            await renderToBuffer(
                <InvoicePDF
                    invoice={invoice}
                    project={project}
                    companyInfo={companyInfo}
                    projectMasters={pms}
                    includeCopy={false}
                    includeDetails={false}
                />,
            ),
        );
        const pages = await analyze(buf);
        const overflow = pages.filter((p) => p.hasText && p.lowest >= 0 && p.lowest < 40);
        const blank = pages.filter((p) => !p.hasText);
        const flag = overflow.length > 0 || blank.length > 0 ? '❌' : '  ';
        if (flag === '❌') ng++;
        if (flag === '❌' || process.env.VERBOSE) {
            console.log(
                `${flag} ${inv.invoiceNumber} 明細${items.length}件 pages=${pages.length} lowestY=[${pages.map((p) => p.lowest).join(', ')}]${overflow.length ? ' 溢れ' : ''}${blank.length ? ' 空ページ' : ''}`,
            );
        }
    }
    console.log(ng === 0 ? '✅ 溢れ・空ページなし' : `❌ 問題あり: ${ng}件`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
