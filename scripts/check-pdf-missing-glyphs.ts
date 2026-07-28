/**
 * PDF フォント（CDN の noto-sans-jp japanese サブセット）に存在しない文字が
 * 実データ（案件名・顧客名・見積/請求の明細など）にどれだけ含まれるかを調べる読み取り専用スクリプト。
 *
 * 背景: 請求書 PDF で「濱田」の「濱」等が空白になる報告あり。
 *       サブセットのグリフ欠落か、互換漢字/異体字セレクタ混入かを実データで切り分ける。
 *
 * 実行: npx tsx scripts/check-pdf-missing-glyphs.ts
 * ※ SELECT のみ。書き込みは一切行わない。
 */
import { PrismaClient } from '@prisma/client';

// fontkit は @react-pdf/renderer の推移的依存で型定義が無いため require で読む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('fontkit') as {
    create(buf: Buffer): { hasGlyphForCodePoint(cp: number): boolean };
    openSync(path: string): { hasGlyphForCodePoint(cp: number): boolean };
};

const prisma = new PrismaClient();

const CDN_400 =
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-400-normal.woff';

async function loadSubsetFont() {
    const res = await fetch(CDN_400);
    const buf = Buffer.from(await res.arrayBuffer());
    return fontkit.create(buf);
}

function codePoints(s: string): string {
    return [...s].map((ch) => 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase()).join(' ');
}

async function main() {
    const font = await loadSubsetFont();
    const localFont = fontkit.openSync('public/fonts/NotoSansJP-Regular.ttf');

    const missing = new Map<string, { count: number; inLocal: boolean; samples: Set<string> }>();

    const record = (text: string | null | undefined, label: string) => {
        if (!text) return;
        for (const ch of text) {
            const cp = ch.codePointAt(0)!;
            if (cp < 0x20) continue; // 制御文字・改行
            if (font.hasGlyphForCodePoint(cp)) continue;
            if (!missing.has(ch)) {
                missing.set(ch, {
                    count: 0,
                    inLocal: localFont.hasGlyphForCodePoint(cp),
                    samples: new Set(),
                });
            }
            const e = missing.get(ch)!;
            e.count += 1;
            if (e.samples.size < 4) e.samples.add(`${label}: ${text.slice(0, 60)}`);
        }
    };

    const pms = await prisma.projectMaster.findMany({
        select: {
            name: true,
            title: true,
            customerName: true,
            customerShortName: true,
            location: true,
            siteShortName: true,
            description: true,
            remarks: true,
        },
    });
    for (const p of pms) {
        record(p.name, '案件name');
        record(p.title, '案件title');
        record(p.customerName, '案件顧客名');
        record(p.customerShortName, '案件顧客略称');
        record(p.location, '案件所在地');
        record(p.siteShortName, '案件現場略称');
        record(p.description, '案件説明');
        record(p.remarks, '案件備考');
    }
    console.log(`ProjectMaster: ${pms.length}件`);

    const customers = await prisma.customer.findMany({
        select: { name: true, shortName: true, contactPersons: true, address: true, notes: true },
    });
    for (const c of customers) {
        record(c.name, '顧客name');
        record(c.shortName, '顧客略称');
        record(c.contactPersons, '顧客担当');
        record(c.address, '顧客住所');
        record(c.notes, '顧客備考');
    }
    console.log(`Customer: ${customers.length}件`);

    const users = await prisma.user.findMany({ select: { displayName: true } });
    for (const u of users) record(u.displayName, 'ユーザー表示名');
    console.log(`User: ${users.length}件`);

    const invoices = await prisma.invoice.findMany({
        select: { title: true, items: true, notes: true },
    });
    for (const i of invoices) {
        record(i.title, '請求title');
        record(i.items, '請求明細JSON');
        record(i.notes, '請求notes');
    }
    console.log(`Invoice: ${invoices.length}件`);

    const estimates = await prisma.estimate.findMany({
        select: { title: true, items: true, notes: true, location: true, createdByName: true },
    });
    for (const e of estimates) {
        record(e.title, '見積title');
        record(e.items, '見積明細JSON');
        record(e.notes, '見積notes');
        record(e.location, '見積所在地');
        record(e.createdByName, '見積作成者');
    }
    console.log(`Estimate: ${estimates.length}件`);

    console.log('\n=== CDNサブセットにグリフが無い文字（PDFで空白になる） ===');
    if (missing.size === 0) console.log('  なし');
    const sorted = [...missing.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [ch, info] of sorted) {
        const cp = ch.codePointAt(0)!;
        console.log(
            `  "${ch}" U+${cp.toString(16).toUpperCase().padStart(4, '0')}  出現${info.count}回  同梱フルTTF: ${info.inLocal ? 'OK' : 'これも無い'}`,
        );
        for (const s of info.samples) console.log(`      ${s}`);
    }

    console.log('\n=== 「濱/濵」を含む案件のコードポイント ===');
    const targets = pms.filter((p) =>
        /[濱濵]/.test(`${p.name ?? ''}${p.title ?? ''}${p.customerName ?? ''}`),
    );
    for (const t of targets.slice(0, 20)) {
        const s = t.title || t.name || t.customerName || '';
        console.log(`  "${s}" → ${codePoints(s)}`);
    }
    if (targets.length === 0) console.log('  該当なし（別字形の可能性）');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
