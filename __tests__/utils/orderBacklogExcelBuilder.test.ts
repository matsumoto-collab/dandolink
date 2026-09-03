/**
 * 受注明細書Excel（utils/orderBacklogExcelBuilder.ts）のテスト。
 *
 * 実際のテンプレ（public/templates/order-backlog-template.xlsx）を読み、
 * buildOrderBacklogSheet の戻りから xlsx を生成して中身を確かめる。
 * scripts/verify-order-backlog-excel.ts と同じ観点を CI で回すためのもの。
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { bucketBottomLabel, bucketTopLabel } from '@/lib/orderBacklog/buckets';
import { buildOrderBacklogSheet, type OrderBacklogSheetReport } from '@/lib/orderBacklog/render';
import type { OrderBacklogLineInput } from '@/lib/orderBacklog/types';
import { buildOrderBacklogWorkbook, padApplicantLabel } from '@/utils/orderBacklogExcelBuilder';

jest.setTimeout(60000);

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'order-backlog-template.xlsx');
const SCHEDULE_COLUMNS = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;

const REPORT: OrderBacklogSheetReport = {
    asOfDate: '2026-06-01',
    applicantName: null,
    individualThreshold: 1000000,
    unreceivedMode: 'remaining',
};

const line = (
    over: Partial<OrderBacklogLineInput> &
        Pick<OrderBacklogLineInput, 'customerName' | 'projectName' | 'contractAmount'>
): OrderBacklogLineInput => ({
    projectMasterId: null,
    workKind: 'temp',
    siteKind: 'other',
    startYm: null,
    endYm: null,
    progressRate: 0,
    receivedAmount: 0,
    schedule: {},
    excluded: false,
    isManual: false,
    sortOrder: 0,
    ...over,
});

/** 個別行3件（100万以上）＋ 区分に落ちる小口5件 */
const LINES: OrderBacklogLineInput[] = [
    line({
        customerName: 'アレスホーム',
        projectName: '中央区マンション　仮設足場',
        contractAmount: 12_000_000,
        startYm: '2026-05',
        endYm: '2026-08',
        progressRate: 50,
        receivedAmount: 3_000_000,
        schedule: { '2026-06': 5_400_000, '2026-08': 3_600_000 },
        sortOrder: 1,
    }),
    line({
        customerName: '今井建設',
        projectName: '倉庫改修　仮設工事',
        contractAmount: 8_000_000,
        startYm: '2026-03',
        endYm: '2026-06',
        progressRate: 100,
        // 基準月より前のキーは第1列に寄る
        schedule: { '2026-04': 8_000_000 },
        sortOrder: 2,
    }),
    line({
        customerName: '髙橋工務店',
        projectName: '濵田様邸　新築足場',
        contractAmount: 2_500_000,
        workKind: 'new',
        siteKind: 'house',
        startYm: '2026-06',
        endYm: '2027-03',
        progressRate: 20,
        receivedAmount: 500_000,
        // 基準月+8 以降は最終列（S）へ
        schedule: { later: 2_500_000 },
        sortOrder: 3,
    }),
    line({ customerName: 'A社', projectName: '小口1', contractAmount: 800_000, schedule: { '2026-07': 800_000 }, sortOrder: 4 }),
    line({ customerName: 'B社', projectName: '小口2', contractAmount: 600_000, schedule: { '2026-07': 600_000 }, sortOrder: 5 }),
    line({ customerName: 'C社', projectName: '小口3', contractAmount: 300_000, siteKind: 'house', schedule: { '2026-06': 300_000 }, sortOrder: 6 }),
    line({ customerName: 'D社', projectName: '小口4', contractAmount: 900_000, workKind: 'new', schedule: { '2026-09': 900_000 }, sortOrder: 7 }),
    line({ customerName: 'E社', projectName: '小口5', contractAmount: 400_000, workKind: 'new', siteKind: 'house', schedule: { later: 400_000 }, sortOrder: 8 }),
];

type CellValue = string | number | null;

/** シートXMLから1セルの値を読む（inlineStr は文字列・それ以外は <v> の数値） */
function readCell(xml: string, ref: string): CellValue {
    const m = new RegExp(`<c r="${ref}"[^>]*?(/>|>[\\s\\S]*?</c>)`).exec(xml);
    if (!m) return null;
    const inline = /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(m[0]);
    if (inline) {
        return inline[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }
    const v = /<v>([\s\S]*?)<\/v>/.exec(m[0]);
    if (!v) return null;
    const n = Number(v[1]);
    return Number.isFinite(n) ? n : v[1];
}

async function openWorkbook(bytes: Uint8Array): Promise<{ names: string[]; sheetXml: string[] }> {
    const zip = await JSZip.loadAsync(bytes);
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const names = [...workbookXml.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    const sheetXml: string[] = [];
    for (let i = 1; i <= names.length; i++) {
        sheetXml.push(await zip.file(`xl/worksheets/sheet${i}.xml`)!.async('string'));
    }
    return { names, sheetXml };
}

describe('buildOrderBacklogWorkbook', () => {
    const templateBytes = fs.readFileSync(TEMPLATE_PATH);
    const sheet = buildOrderBacklogSheet(REPORT, LINES);
    let names: string[] = [];
    let xml = '';

    beforeAll(async () => {
        const bytes = await buildOrderBacklogWorkbook(templateBytes, sheet);
        const wb = await openWorkbook(bytes);
        names = wb.names;
        xml = wb.sheetXml[0];
    });

    it('シート1枚・シート名「受注明細書」', () => {
        expect(names).toEqual(['受注明細書']);
    });

    it('数式（<f>）が1つも残っていない', () => {
        expect(xml).not.toMatch(/<f[\s>/]/);
    });

    it('見出し: F5=基準日ラベル / B6=申込人（テンプレと同じ39文字）', () => {
        expect(readCell(xml, 'F5')).toBe('（令和8年6月1日現在）');
        const applicant = String(readCell(xml, 'B6'));
        expect(applicant.startsWith('申込人　')).toBe(true);
        expect(applicant).toHaveLength(39);
    });

    it('K9〜S9 が基準月からの月数値（12 の次は 1 に巻き戻る）', () => {
        const months = SCHEDULE_COLUMNS.map((col) => readCell(xml, `${col}9`));
        expect(months).toEqual([6, 7, 8, 9, 10, 11, 12, 1, 2]);
    });

    it('明細1枠目（行10・11）の各列', () => {
        expect(readCell(xml, 'B10')).toBe(1);
        expect(readCell(xml, 'C10')).toBe('アレスホーム');
        expect(readCell(xml, 'C11')).toBe('中央区マンション　仮設足場');
        expect(readCell(xml, 'E10')).toBe(12000);
        expect(readCell(xml, 'F10')).toBe('2026/5');
        expect(readCell(xml, 'F11')).toBe('2026/8');
        expect(readCell(xml, 'G10')).toBe(0.5);
        expect(readCell(xml, 'H10')).toBe(6000);
        expect(readCell(xml, 'I10')).toBe(3000);
        expect(readCell(xml, 'J10')).toBe(6000);
    });

    it('入金予定 K10〜S10 は 0 を書かず空欄にする', () => {
        const values = SCHEDULE_COLUMNS.map((col) => readCell(xml, `${col}10`));
        expect(values).toEqual([5400, null, 3600, null, null, null, null, null, null]);
    });

    it('基準月より前の入金予定は第1列・later は最終列へ', () => {
        expect(readCell(xml, 'K12')).toBe(8000); // 2026-04 → 基準月(6月)の列
        expect(readCell(xml, 'S14')).toBe(2500); // later → 「2月以降」の列
        expect(readCell(xml, 'K14')).toBeNull();
    });

    it('区分行は見出し文字列を出し、着工/完成/出来高は空欄', () => {
        expect(readCell(xml, 'C16')).toBe(bucketTopLabel('temp_other_mid', 2));
        expect(readCell(xml, 'C17')).toBe(bucketBottomLabel('temp_other_mid'));
        expect(readCell(xml, 'E16')).toBe(1400);
        expect(readCell(xml, 'F16')).toBeNull();
        expect(readCell(xml, 'F17')).toBeNull();
        expect(readCell(xml, 'G16')).toBeNull();
        expect(readCell(xml, 'H16')).toBeNull();
    });

    it('計（行62）は表示している千円の合計と一致する', () => {
        const sumOf = (pick: (r: (typeof sheet.rows)[number]) => number) =>
            sheet.rows.reduce((s, r) => s + pick(r), 0);
        expect(readCell(xml, 'B62')).toBe('計');
        expect(readCell(xml, 'E62')).toBe(sumOf((r) => r.contractK));
        expect(readCell(xml, 'I62')).toBe(sumOf((r) => r.receivedK));
        expect(readCell(xml, 'J62')).toBe(sumOf((r) => r.unreceivedK));
        SCHEDULE_COLUMNS.forEach((col, i) => {
            expect(readCell(xml, `${col}62`)).toBe(sumOf((r) => r.scheduleK[i] ?? 0));
        });
    });

    it('計は 0 でも書く（未記入に見えないように）', () => {
        // O列（2026-10）は入金予定が無いので合計 0
        expect(sheet.totals.scheduleK[4]).toBe(0);
        expect(readCell(xml, 'O62')).toBe(0);
    });
});

describe('buildOrderBacklogWorkbook（27件＝2シート）', () => {
    const templateBytes = fs.readFileSync(TEMPLATE_PATH);
    const many: OrderBacklogLineInput[] = Array.from({ length: 27 }, (_, i) =>
        line({
            customerName: `顧客${i + 1}`,
            projectName: `工事${i + 1}`,
            contractAmount: 30_000_000 - i * 1_000_000,
            progressRate: 50,
            schedule: { '2026-06': 1_000_000 },
            sortOrder: i,
        })
    );
    const sheet = buildOrderBacklogSheet(REPORT, many);
    let names: string[] = [];
    let sheetXml: string[] = [];

    beforeAll(async () => {
        const bytes = await buildOrderBacklogWorkbook(templateBytes, sheet);
        const wb = await openWorkbook(bytes);
        names = wb.names;
        sheetXml = wb.sheetXml;
    });

    it('シートが2枚（受注明細書 / 受注明細書(2)）', () => {
        expect(names).toEqual(['受注明細書', '受注明細書(2)']);
    });

    it('符号は通し番号で2枚目へ続く', () => {
        expect(readCell(sheetXml[0], 'B10')).toBe(1);
        expect(readCell(sheetXml[0], 'B60')).toBe(26);
        expect(readCell(sheetXml[1], 'B10')).toBe(27);
        expect(readCell(sheetXml[1], 'B12')).toBeNull();
    });

    it('計は最終シートにだけ出る', () => {
        expect(readCell(sheetXml[0], 'B62')).toBeNull();
        expect(readCell(sheetXml[1], 'B62')).toBe('計');
        expect(readCell(sheetXml[1], 'E62')).toBe(sheet.totals.contractK);
    });

    it('2枚目にも見出し（入金予定の月）が入る', () => {
        expect(readCell(sheetXml[1], 'K9')).toBe(6);
    });

    it('どちらのシートにも数式が無い', () => {
        for (const x of sheetXml) expect(x).not.toMatch(/<f[\s>/]/);
    });
});

describe('padApplicantLabel', () => {
    it('テンプレの B6 と同じ39文字まで全角空白で埋める', () => {
        expect(padApplicantLabel('申込人　')).toHaveLength(39);
        expect(padApplicantLabel('申込人　山田太郎')).toHaveLength(39);
        expect(padApplicantLabel('申込人　山田太郎')).toMatch(/^申込人　山田太郎　+$/);
    });

    it('39文字以上ならそのまま返す', () => {
        const long = `申込人　${'あ'.repeat(40)}`;
        expect(padApplicantLabel(long)).toBe(long);
    });
});
