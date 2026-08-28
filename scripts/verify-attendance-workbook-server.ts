/**
 * 出勤簿Excelがサーバー側だけで組み立てられることの検証。
 *
 * 人事システム向けの GET /api/external/attendance/workbook は、集計を
 * utils/attendanceMonthlyData.ts（react-pdf 非依存）、組み立てを
 * utils/attendanceMonthlyExcelBuilder.ts で行う。どちらもブラウザ側の
 * 出勤簿出力と共有しているモジュールで、二重実装にしていない。
 *
 * ここで確かめること:
 *   1. **@react-pdf/renderer を一切読み込まずに**ブックが作れること
 *      （'use client' の utils/attendanceMonthlyPdf.tsx を経由していない）
 *   2. テンプレートが public から読めること（Vercel では next.config.js の
 *      outputFileTracingIncludes で関数に同梱される）
 *   3. 人数ぶんのシートができ、氏名・年月・日別の値が入ること
 *
 * 実行: npx tsx scripts/verify-attendance-workbook-server.ts
 */
import fs from 'fs';
import path from 'path';
import Module from 'module';
import JSZip from 'jszip';

// ---- 1. react-pdf が読み込まれたら即座に落とす番人を仕掛ける ----
// require が通ってしまうと「サーバーで動く」ことの証明にならないため、
// 実際に import される瞬間を捕まえる。
const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
let reactPdfLoaded: string | null = null;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(
    ...args: unknown[]
) {
    const request = String(args[0]);
    if (request.includes('@react-pdf') || request === 'react-pdf') {
        reactPdfLoaded = request;
    }
    return originalLoad.apply(this, args as never);
};

const TEMPLATE_PATH = path.join(
    process.cwd(),
    'public',
    'templates',
    'attendance-monthly-template.xlsx'
);

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
    console.log(`${ok ? '  OK  ' : '  NG  '} ${label}${detail ? `  — ${detail}` : ''}`);
    if (!ok) failures += 1;
}

async function main() {
    // 動的 import にして、番人を仕掛けた後に読ませる
    const { buildAttendanceMonthlyPdfData } = await import('../utils/attendanceMonthlyData');
    const { buildAttendanceWorkbook } = await import('../utils/attendanceMonthlyExcelBuilder');

    console.log('\n【1】react-pdf を読み込まずに集計・組み立てモジュールが読める');
    check('@react-pdf/renderer が読み込まれていない', reactPdfLoaded === null, reactPdfLoaded ?? 'なし');

    console.log('\n【2】テンプレートが読める');
    check('public/templates/attendance-monthly-template.xlsx が存在する', fs.existsSync(TEMPLATE_PATH));
    const template = fs.readFileSync(TEMPLATE_PATH);
    check('サイズが妥当', template.length > 1000, `${Math.round(template.length / 1024)}KB`);

    // ---- 令和8年6月 ムー フィクリさんの出勤簿（実物PDFの1ページ目と同じ内容）----
    const HOLIDAYS = new Set([7, 13, 14, 20, 21, 28]);
    const PAID_LEAVE = new Set([12]);
    const records = [];
    for (let day = 1; day <= 30; day += 1) {
        const date = `2026-06-${String(day).padStart(2, '0')}`;
        const status = HOLIDAYS.has(day) ? 'holiday' : PAID_LEAVE.has(day) ? 'paid_leave' : 'present';
        records.push({
            userId: 'u1',
            date,
            status,
            earlyStartMinutes: 0,
            morningLoadingMinutes: 0,
            overtimeMinutes: 0,
            eveningLoadingMinutes: 0,
            earlyEndTime: null,
            note: null,
        });
    }
    // 2人目は出勤日を1日減らして、シートごとに別の集計になることを見る
    for (const r of records.slice(0, 30)) {
        records.push({ ...r, userId: 'u2', status: r.date.endsWith('-27') ? 'holiday' : r.status });
    }

    console.log('\n【3】2名ぶんのブックを組み立てる');
    const sheets = [
        { userName: 'ムー　フィクリ', data: buildAttendanceMonthlyPdfData(2026, 6, 'u1', records) },
        { userName: 'イワン　サリ', data: buildAttendanceMonthlyPdfData(2026, 6, 'u2', records) },
    ];
    check('1人目の出勤日数が23日', sheets[0].data.summary.presentDays === 23, `${sheets[0].data.summary.presentDays}日`);
    check('1人目の有給が1日', sheets[0].data.summary.paidLeaveDays === 1, `${sheets[0].data.summary.paidLeaveDays}日`);
    check('2人目の出勤日数が22日', sheets[1].data.summary.presentDays === 22, `${sheets[1].data.summary.presentDays}日`);

    const buffer = await buildAttendanceWorkbook(template, 2026, 6, sheets);
    check('ブックが生成された', buffer.byteLength > 1000, `${Math.round(buffer.byteLength / 1024)}KB`);

    console.log('\n【4】出来上がったブックの中身');
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    check('シートが2枚', sheetNames.length === 2, sheetNames.join(' / '));
    check('シート名が氏名になっている', sheetNames[0].includes('ムー'), sheetNames[0]);

    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    check('年が入っている', /<c r="A2"[^>]*><v>2026<\/v>/.test(sheet1));
    check('月が入っている', /<c r="D2"[^>]*><v>6<\/v>/.test(sheet1));
    check('氏名が入っている', sheet1.includes('ムー'), '');
    check('数式が残っていない', !/<f[\s>]/.test(sheet1));
    check('罫線スタイルが保たれている', /<c r="A5"[^>]*\ss="\d+"/.test(sheet1));

    console.log('\n【5】最後にもう一度 react-pdf の読み込みを確認');
    check('最後まで @react-pdf/renderer は読み込まれなかった', reactPdfLoaded === null, reactPdfLoaded ?? 'なし');

    console.log(`\n${failures === 0 ? '✅ すべて通過' : `❌ ${failures}件 失敗`}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
