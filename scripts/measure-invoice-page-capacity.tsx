/**
 * 請求書PDF（表紙）が1ページに収められる明細行数の実測スクリプト。
 *
 * InvoicePDF.tsx のページ分割は FIRST_ / CONT_ の行数上限で判断しているが、
 * これは実描画の高さから手計算した安全値であり、実際の余白と乖離すると
 * 「下部が大きく空いたまま次ページへ送られる」ことが起きる（2026-07-28 kei報告）。
 * 上限を実測で決めるため、案件数を振って PDF を生成し、実ページ数と
 * テキスト最下端の Y 座標（＝下余白）を出す。
 *
 * 使い方:
 *   1) InvoicePDF.tsx の FIRST_WITH_TOTALS 等を十分大きい値（99 等）にして分割を無効化
 *   2) npx tsx scripts/measure-invoice-page-capacity.tsx
 *   3) pages が 2 になる直前の行数が実容量。安全マージンを引いて定数を決める
 *
 * ※ DB へは一切アクセスしない（合成データ）。
 */
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePDF } from '../components/pdf/InvoicePDF';
import '../lib/pdf/registerServerFonts';
import type { Invoice } from '../types/invoice';
import type { Project } from '../types/calendar';
import type { CompanyInfo } from '../types/company';

// 実データ（河窪建設 I20260114）に近い形。案件ごとに「見出し1行＋明細1行」＝span2。
function makeInvoice(projectCount: number, opts?: { notes?: string }): { invoice: Invoice; masters: Array<{ id: string; title: string }> } {
    const masters = Array.from({ length: projectCount }, (_, i) => ({
        id: `pm-${i}`,
        title: `テスト案件${i + 1}様邸 新築工事`,
    }));
    const items = masters.map((m, i) => ({
        id: `item-${i}`,
        description: '外部足場組立・解体',
        specification: '',
        quantity: 1,
        unit: '式',
        unitPrice: 60000,
        amount: 60000,
        notes: '',
        projectMasterId: m.id,
    }));
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const invoice = {
        id: 'inv-test',
        invoiceNumber: 'I20260114',
        title: '令和8年7月25日締めご請求書',
        items,
        subtotal,
        tax: Math.floor(subtotal * 0.1),
        total: subtotal + Math.floor(subtotal * 0.1),
        status: 'sent',
        createdAt: new Date('2026-07-25'),
        dueDate: new Date('2026-09-10'),
        notes: opts?.notes ?? '',
    } as unknown as Invoice;
    return { invoice, masters };
}

const project = {
    id: 'p-test',
    title: '令和8年7月25日締めご請求書',
    customer: '河窪建設株式会社',
    customerHonorific: '御中',
    customerPostalCode: '791-8041',
    customerAddress: '愛媛県松山市北吉田町1038番地',
} as unknown as Project;

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

async function analyze(buf: Buffer): Promise<{ pages: number; lowestY: number[] }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const lowestY: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let min = Infinity;
        for (const it of content.items as any[]) {
            if (!it.str || !it.str.trim()) continue;
            // フッター（ページ番号 y≈14）は除外して「本文の最下端」を見る
            const y = Math.round(it.transform[5]);
            if (y < 20) continue;
            min = Math.min(min, y);
        }
        lowestY.push(min === Infinity ? -1 : min);
    }
    return { pages: doc.numPages, lowestY };
}

// ページ高さを動かす要素のバリエーション。容量の動的減算が効いているかを確認する。
const VARIANTS: Record<string, { notes?: string; banks?: number }> = {
    base: {},
    notes4: { notes: '※壁つなぎ補修の合番を12日分お願いいたします。\n※足場の解体は先行足場を残して実施します。\n※雨天順延の場合は前日にご連絡します。\n※請求書の内訳は別紙の通りです。' },
    bank3: { banks: 3 },
    both: {
        notes: '※壁つなぎ補修の合番を12日分お願いいたします。\n※足場の解体は先行足場を残して実施します。\n※雨天順延の場合は前日にご連絡します。\n※請求書の内訳は別紙の通りです。',
        banks: 3,
    },
};

async function main() {
    const counts = process.argv[2]
        ? process.argv[2].split(',').map(Number)
        : [9, 10, 11, 12, 13, 14, 15];
    const variantKey = process.argv[3] || 'base';
    const variant = VARIANTS[variantKey];
    if (!variant) {
        console.error(`unknown variant: ${variantKey}（${Object.keys(VARIANTS).join(' / ')}）`);
        process.exit(1);
    }
    const ci = variant.banks
        ? { ...companyInfo, bankAccounts: [
            ...(companyInfo.bankAccounts as any[]),
            { bankName: '三菱UFJ銀行', branchName: '松山支店', accountType: '普', accountNumber: '1234567' },
        ].slice(0, variant.banks) }
        : companyInfo;
    console.log(`variant=${variantKey}（振込先${(ci as any).bankAccounts.length}件 / 備考${variant.notes ? variant.notes.split('\n').length + '行' : 'なし'}）`);
    console.log('案件数 / span(=案件数×2) / PDFページ数 / 各ページの本文最下端Y（下端=40pt が用紙の余白）');
    for (const n of counts) {
        const { invoice, masters } = makeInvoice(n, { notes: variant.notes });
        const buf = Buffer.from(
            await renderToBuffer(
                <InvoicePDF
                    invoice={invoice}
                    project={project}
                    companyInfo={ci}
                    projectMasters={masters}
                    includeCopy={false}
                    includeDetails={false}
                />,
            ),
        );
        const { pages, lowestY } = await analyze(buf);
        console.log(`  案件${String(n).padStart(2)}  span=${String(n * 2).padStart(2)}  pages=${pages}  lowestY=[${lowestY.join(', ')}]`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
