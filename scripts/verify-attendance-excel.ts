/**
 * 出勤簿Excel出力（テンプレZIP差し替え方式）の検証スクリプト。
 *
 * 合成レコードで個人出力・まとめ出力（3名）を組み立て、
 *   - 各シートXMLが well-formed で、条件付き書式・結合セル・データ検証・印刷設定が残っていること
 *   - 数式（<f>）が1つも残っていないこと（残ると開いた瞬間に再計算されて値が壊れる）
 *   - セルの値が buildAttendanceMonthlyPdfData（PDFと共通の集計）と一致すること
 *   - まとめ出力のシート順・シート名の一意化
 * を検証する。DBへは一切アクセスしない。
 *
 * 実行: npx tsx scripts/verify-attendance-excel.ts
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
    buildAttendanceMonthlyPdfData,
    type AttendancePdfRecord,
} from '../utils/attendanceMonthlyPdf';
import {
    buildAttendanceWorkbook,
    excelSerialFromDate,
    normalizeMinusSign,
    parseHmToMinutes,
    type AttendanceExcelSheetInput,
} from '../utils/attendanceMonthlyExcelBuilder';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'templates', 'attendance-monthly-template.xlsx');

let checks = 0;
function assert(cond: unknown, message: string): asserts cond {
    checks += 1;
    if (!cond) throw new Error(`検証失敗: ${message}`);
}

function assertWellFormedXml(xml: string, label: string): void {
    assert(xml.startsWith('<?xml'), `${label}: XML宣言が無い`);
    const badAmp = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(xml);
    assert(!badAmp, `${label}: 未エスケープの & がある (pos ${badAmp?.index})`);
    const stack: string[] = [];
    const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(xml)) !== null) {
        const [, closing, name, attrs, selfClose] = m;
        if (closing) {
            const top = stack.pop();
            assert(top === name, `${label}: タグ不整合 </${name}> (期待 </${top}>)`);
        } else if (!selfClose && !attrs.endsWith('/')) {
            stack.push(name);
        }
    }
    assert(stack.length === 0, `${label}: 閉じられていないタグ ${stack.join(',')}`);
}

// ---------------------------------------------------------------- 合成データ

function rec(
    userId: string,
    date: string,
    status: string,
    extra: Partial<AttendancePdfRecord> = {}
): AttendancePdfRecord {
    return {
        userId,
        date,
        status,
        earlyStartMinutes: 0,
        morningLoadingMinutes: 0,
        overtimeMinutes: 0,
        eveningLoadingMinutes: 0,
        earlyEndTime: null,
        note: null,
        ...extra,
    };
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * 濃いめの合成データ:
 *  - 出勤・休日・有給・欠勤が混在
 *  - 早終あり（earlyEndTime）
 *  - 備考に XML 特殊文字（& < > " '）
 *  - 時間外合計が 24 時間を超える（月合計は時刻シリアルでは表現できない）
 */
function makeRecords(userId: string, year: number, month: number): AttendancePdfRecord[] {
    const daysInMonth = new Date(year, month, 0).getDate();
    const out: AttendancePdfRecord[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${pad2(month)}-${pad2(day)}`;
        const dow = new Date(year, month - 1, day).getDay();
        if (day === 3) {
            out.push(rec(userId, date, 'paid_leave', { note: '有給 & 私用' }));
            continue;
        }
        if (day === 4) {
            out.push(rec(userId, date, 'absent', { note: '<欠勤> "体調不良"' }));
            continue;
        }
        if (day === 5) {
            // 早終（15:30 上がり = 早終 1:30）
            out.push(rec(userId, date, 'present', { earlyEndTime: '15:30', note: "現場 'A' 早上がり" }));
            continue;
        }
        if (dow === 0) {
            out.push(rec(userId, date, 'holiday'));
            continue;
        }
        out.push(
            rec(userId, date, 'present', {
                earlyStartMinutes: 30,
                morningLoadingMinutes: 60,
                overtimeMinutes: 60,
                eveningLoadingMinutes: 30,
                note: day === 1 ? '打合せ & 資料<A> "確認"' : '',
            })
        );
    }
    return out;
}

// ---------------------------------------------------------------- シート検証

function cell(ws: XLSX.WorkSheet, ref: string): XLSX.CellObject | undefined {
    return ws[ref] as XLSX.CellObject | undefined;
}

function assertEmptyCell(ws: XLSX.WorkSheet, ref: string, label: string): void {
    const c = cell(ws, ref);
    assert(c === undefined || c.v === undefined || c.v === '', `${label}: ${ref} が空でない (${String(c?.v)})`);
}

function assertNumberCell(ws: XLSX.WorkSheet, ref: string, expected: number, label: string): void {
    const c = cell(ws, ref);
    assert(c && typeof c.v === 'number', `${label}: ${ref} が数値でない (${String(c?.v)})`);
    assert(
        Math.abs((c!.v as number) - expected) < 1e-9,
        `${label}: ${ref} = ${String(c!.v)} (期待 ${expected})`
    );
}

function assertTextCell(ws: XLSX.WorkSheet, ref: string, expected: string, label: string): void {
    const c = cell(ws, ref);
    assert(c && String(c.v) === expected, `${label}: ${ref} = ${String(c?.v)} (期待 ${expected})`);
}

/** "h:mm" が実値なら時刻シリアルセル、空・0:00 なら空セル */
function assertTimeCell(ws: XLSX.WorkSheet, ref: string, hm: string, label: string, allowZero = false): void {
    const min = parseHmToMinutes(hm);
    if (min === null || (min === 0 && !allowZero)) {
        assertEmptyCell(ws, ref, label);
    } else {
        assertNumberCell(ws, ref, min / 1440, label);
    }
}

function verifySheet(
    ws: XLSX.WorkSheet,
    year: number,
    month: number,
    userName: string,
    userId: string,
    records: AttendancePdfRecord[],
    label: string
): void {
    const { days, totals, summary } = buildAttendanceMonthlyPdfData(year, month, userId, records);

    // 見出し
    assertNumberCell(ws, 'A2', year, label);
    assertNumberCell(ws, 'D2', month, label);
    assertTextCell(ws, 'H2', userName, label);
    // 固定ラベルが生きていること（テンプレ由来）
    assertTextCell(ws, 'G2', '氏名', label);
    assertTextCell(ws, 'J39', '時間外合計', label);

    // 日別
    for (let row = 5; row <= 35; row++) {
        const day = row - 4;
        const d = days[day - 1];
        if (!d) {
            for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
                assertEmptyCell(ws, `${col}${row}`, `${label}(当月外の行)`);
            }
            continue;
        }
        const serial = excelSerialFromDate(year, month, day);
        assertNumberCell(ws, `A${row}`, serial, label);
        assertNumberCell(ws, `B${row}`, serial, label);
        if (d.statusLabel) assertTextCell(ws, `C${row}`, d.statusLabel, label);
        else assertEmptyCell(ws, `C${row}`, label);
        assertTimeCell(ws, `D${row}`, d.earlyStart, label);
        assertTimeCell(ws, `E${row}`, d.morningLoading, label);
        assertTimeCell(ws, `F${row}`, d.startTime, label);
        assertTimeCell(ws, `G${row}`, d.endTime, label);
        assertTimeCell(ws, `H${row}`, d.overtime, label);
        assertTimeCell(ws, `I${row}`, d.eveningLoading, label);
        assertTimeCell(ws, `J${row}`, d.breakTime, label);
        assertTimeCell(ws, `K${row}`, d.actual, label, true);
        if (d.diff) assertTextCell(ws, `L${row}`, normalizeMinusSign(d.diff), label);
        else assertEmptyCell(ws, `L${row}`, label);
        if (d.note) assertTextCell(ws, `M${row}`, d.note, label);
        else assertEmptyCell(ws, `M${row}`, label);
    }

    // 合計時間行
    assertTextCell(ws, 'L36', normalizeMinusSign(totals.diff), label);
    for (const ref of ['F36', 'G36', 'H36', 'I36', 'J36', 'K36', 'M36']) {
        assertEmptyCell(ws, ref, label);
    }

    // サマリー
    assertNumberCell(ws, 'F38', summary.presentDays, label);
    assertNumberCell(ws, 'F39', summary.absentDays, label);
    assertNumberCell(ws, 'F40', summary.paidLeaveDays, label);
    assertTextCell(ws, 'I38', summary.morningLoading, label);
    assertTextCell(ws, 'I39', summary.earlyStartOvertime, label);
    assertTextCell(ws, 'I40', summary.earlyEnd, label);
    assertTextCell(ws, 'M38', summary.eveningLoading, label);
    assertTextCell(ws, 'M39', summary.overtimeTotal, label);
    assertTextCell(ws, 'M40', normalizeMinusSign(summary.grandTotal), label);
    // 半角マイナスに正規化されていること（全角は Excel で計算・検索に引っかからない）
    for (const ref of ['L36', 'M40']) {
        assert(!/[−‒–—－]/.test(String(cell(ws, ref)?.v ?? '')), `${label}: ${ref} に全角マイナスが残っている`);
    }
}

async function verifyPackage(buffer: ArrayBuffer, expectedSheetNames: string[], label: string): Promise<XLSX.WorkBook> {
    const zip = await JSZip.loadAsync(buffer);

    for (const p of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels']) {
        assertWellFormedXml(await zip.file(p)!.async('string'), `${label}/${p}`);
    }
    for (let i = 1; i <= expectedSheetNames.length; i++) {
        const p = `xl/worksheets/sheet${i}.xml`;
        const file = zip.file(p);
        assert(file, `${label}: ${p} が無い`);
        const xml = await file!.async('string');
        assertWellFormedXml(xml, `${label}/${p}`);
        assert(xml.includes('<conditionalFormatting sqref="A5:C35">'), `${label}/${p}: 条件付き書式が無い`);
        assert(xml.includes('<mergeCell '), `${label}/${p}: 結合セルが無い`);
        assert(xml.includes('<dataValidation'), `${label}/${p}: データ検証が無い`);
        assert(xml.includes('scale="87"'), `${label}/${p}: pageSetup scale=87 が無い`);
        assert(!/<f[\s>/]/.test(xml), `${label}/${p}: 数式(<f>)が残っている`);
        assert(
            zip.file(`xl/worksheets/_rels/sheet${i}.xml.rels`),
            `${label}: sheet${i}.xml.rels が無い`
        );
        // rels が指す印刷設定パーツが実在すること
        const rels = await zip.file(`xl/worksheets/_rels/sheet${i}.xml.rels`)!.async('string');
        const printer = /Target="\.\.\/printerSettings\/([^"]+)"/.exec(rels)?.[1];
        assert(printer && zip.file(`xl/printerSettings/${printer}`), `${label}: sheet${i} の印刷設定パーツが無い`);
        // Content_Types に Override があること
        const ct = await zip.file('[Content_Types].xml')!.async('string');
        assert(ct.includes(`PartName="/xl/worksheets/sheet${i}.xml"`), `${label}: sheet${i} の Override が無い`);
    }
    assert(!zip.file(`xl/worksheets/sheet${expectedSheetNames.length + 1}.xml`), `${label}: 余分なシートがある`);
    assert(!zip.file('xl/calcChain.xml'), `${label}: calcChain.xml が残っている`);

    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    assert(
        JSON.stringify(wb.SheetNames) === JSON.stringify(expectedSheetNames),
        `${label}: シート順/名が想定外 ${JSON.stringify(wb.SheetNames)} (期待 ${JSON.stringify(expectedSheetNames)})`
    );
    return wb;
}

// ---------------------------------------------------------------- 実行

async function main(): Promise<void> {
    assert(
        fs.existsSync(TEMPLATE_PATH),
        `テンプレが無い: ${TEMPLATE_PATH}（先に npx tsx scripts/build-attendance-excel-template.ts）`
    );
    const template = fs.readFileSync(TEMPLATE_PATH);

    // --- ケース1: 個人出力・31日の月
    {
        const [year, month] = [2026, 7];
        const userId = 'u1';
        const userName = '田畑 太郎';
        const records = makeRecords(userId, year, month);
        const data = buildAttendanceMonthlyPdfData(year, month, userId, records);

        // 想定どおり 24 時間超のサマリーになっているか（時刻シリアルでは壊れるケース）
        const [h] = data.summary.overtimeTotal.split(':');
        assert(Number(h) > 24, `合成データの時間外合計が24hを超えていない: ${data.summary.overtimeTotal}`);
        assert(data.summary.earlyEnd === '1:30', `早終が想定外: ${data.summary.earlyEnd}`);

        const sheets: AttendanceExcelSheetInput[] = [{ userName, data }];
        const buffer = await buildAttendanceWorkbook(template, year, month, sheets);
        const wb = await verifyPackage(buffer, ['田畑 太郎'], '個人/31日');
        verifySheet(wb.Sheets['田畑 太郎'], year, month, userName, userId, records, '個人/31日');

        // 31日の月は 35 行目まで埋まる
        assert(wb.Sheets['田畑 太郎']['A35']?.v === excelSerialFromDate(year, month, 31), '31日目が35行目に無い');
    }

    // --- ケース2: 個人出力・30日の月（35行目は空になる）
    {
        const [year, month] = [2026, 6];
        const userId = 'u1';
        const userName = '西﨑';
        const records = makeRecords(userId, year, month);
        const data = buildAttendanceMonthlyPdfData(year, month, userId, records);
        const buffer = await buildAttendanceWorkbook(template, year, month, [{ userName, data }]);
        const wb = await verifyPackage(buffer, ['西﨑'], '個人/30日');
        verifySheet(wb.Sheets['西﨑'], year, month, userName, userId, records, '個人/30日');
        for (const col of ['A', 'B', 'C', 'K', 'L', 'M']) {
            assertEmptyCell(wb.Sheets['西﨑'], `${col}35`, '個人/30日(35行目)');
        }
    }

    // --- ケース3: まとめ出力（3名・同名あり・選択順を維持）
    {
        const [year, month] = [2026, 7];
        const people = [
            { userId: 'a', userName: '山本' },
            { userId: 'b', userName: '山本' }, // 同名 → " (2)"
            { userId: 'c', userName: '玉ノ/井:太郎*' }, // 禁止文字入り
        ];
        const records = [
            ...makeRecords('a', year, month),
            ...makeRecords('b', year, month).slice(0, 5),
            ...makeRecords('c', year, month).slice(0, 10),
        ];
        const sheets: AttendanceExcelSheetInput[] = people.map((p) => ({
            userName: p.userName,
            data: buildAttendanceMonthlyPdfData(year, month, p.userId, records),
        }));
        const buffer = await buildAttendanceWorkbook(template, year, month, sheets);
        const expected = ['山本', '山本 (2)', '玉ノ井太郎'];
        const wb = await verifyPackage(buffer, expected, 'まとめ/3名');
        people.forEach((p, i) => {
            verifySheet(wb.Sheets[expected[i]], year, month, p.userName, p.userId, records, `まとめ/${expected[i]}`);
        });
        // 人によって中身が違うこと（テンプレの使い回しでコピーになっていないか）
        assert(
            wb.Sheets['山本']['F38'].v !== wb.Sheets['山本 (2)']['F38'].v,
            'まとめ: 別人のシートが同じ内容になっている'
        );
    }

    // eslint-disable-next-line no-console
    console.log(`出勤簿Excel検証 全パス（${checks} アサーション）`);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
