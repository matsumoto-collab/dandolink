'use client';

/**
 * 見積書の Excel 出力。PDF（components/pdf/EstimatePDF.tsx）と同じ項目・並びを、
 * 金額セルは Excel の数式にして出す（社内で単価を直すと小計・消費税・合計が動く／
 * そのまま顧客にも渡せる見た目＝kei指定）。
 *
 * 会社の既存 Excel 見積書は無いので、テンプレ方式ではなく ExcelJS で新規生成する
 * （既存方針「ExcelJS でスタイルを往復させると劣化」はテンプレ読み書きの話で、白紙生成には当たらない）。
 *
 * シート構成（PDF のページ構成に対応）
 *   1. 御見積書       … 表紙。宛名・合計・会社情報・件名等・明細（表紙用にフラット展開）・小計/消費税/合計
 *   2. 内訳明細書N     … detail カテゴリごとに1シート（表紙のカテゴリ行の金額はこのシートの小計を参照）
 *      見積内訳明細書 … detail カテゴリが無いときは全項目のフラット一覧（PDF と同じ条件）
 *
 * 数式にする範囲
 *   ・金額 = ROUND(数量×単価) は「保存されている金額が数量×単価と一致する行」だけ。手入力の金額は値のまま
 *   ・小計 = 各行の金額の加算式（inline カテゴリの見出し行は子項目と二重になるので除く）
 *   ・消費税 = ROUNDDOWN(課税対象行の金額の合計 × 10%, 0)（EstimateForm の calcTotals と同じ切り捨て）
 *     detail カテゴリの中で課税/非課税が混在する見積は式にできないので、消費税だけ値で入れる
 *   ・合計 = 小計 + 消費税
 */
import type ExcelJS from 'exceljs';
import type { Estimate, EstimateItem } from '@/types/estimate';
import type { Project } from '@/types/calendar';
import type { CompanyInfo } from '@/types/company';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FONT = 'Meiryo UI';
const TAX_RATE = 0.1;

// PDF と同じ配色（components/pdf/styles.ts PDF_COLORS）
const BORDER_DARK = 'FF333333';
const BORDER_MEDIUM = 'FFA3A3A3';
const INFO_BG = 'FFF5F5F5';
const TOTAL_BG = 'FFF0F0F0';
const TEXT_SECONDARY = 'FF525252';

/** 列（1始まり） */
const COL = { no: 1, name: 2, spec: 3, qty: 4, unit: 5, price: 6, amount: 7, remarks: 8 } as const;
const LAST_COL = COL.remarks;

const YEN_FMT = '#,##0;[Red]-#,##0';
const YEN_FMT_SIGN = '"¥"#,##0;[Red]"¥"-#,##0';

const thin = (color: string): ExcelJS.Border => ({ style: 'thin', color: { argb: color } });
const hair = (color: string): ExcelJS.Border => ({ style: 'hair', color: { argb: color } });

function toReiwa(date: Date): string {
    return `令和${date.getFullYear() - 2018}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 表紙用にフラット展開（PDF の flattenItemsForCover と同じ）。inline カテゴリは見出し行＋子項目 */
interface CoverRow {
    item: EstimateItem;
    /** inline カテゴリの見出し行（金額は表示のみ・小計に含めない） */
    inlineHeader: boolean;
    /** detail カテゴリ行（金額は内訳シートの小計を参照） */
    detailCategory: boolean;
    /** inline 見出し行の子項目の範囲（見出し行の金額式に使う） */
    childCount: number;
}

function flattenForCover(items: EstimateItem[]): CoverRow[] {
    const rows: CoverRow[] = [];
    for (const item of items) {
        if (item.isCategory && item.categoryType === 'inline') {
            const children = item.children ?? [];
            rows.push({ item, inlineHeader: true, detailCategory: false, childCount: children.length });
            for (const child of children) rows.push({ item: child, inlineHeader: false, detailCategory: false, childCount: 0 });
        } else if (item.isCategory && (item.children ?? []).length > 0) {
            rows.push({ item, inlineHeader: false, detailCategory: true, childCount: 0 });
        } else {
            rows.push({ item, inlineHeader: false, detailCategory: false, childCount: 0 });
        }
    }
    return rows;
}

/** 保存されている金額が 数量×単価 と一致する行だけ数式にする（手入力の金額は値のまま） */
function amountFormulaOrValue(item: EstimateItem, row: number): ExcelJS.CellValue {
    const computed = Math.round((item.quantity || 0) * (item.unitPrice || 0));
    if (item.quantity > 0 && item.unitPrice !== 0 && computed === Math.round(item.amount || 0)) {
        return { formula: `ROUND(D${row}*F${row},0)`, result: item.amount };
    }
    return item.amount || 0;
}

/** カテゴリの課税判定: 'taxable' 全部課税 / 'exempt' 全部非課税 / 'mixed' 混在 */
function categoryTaxKind(children: EstimateItem[]): 'taxable' | 'exempt' | 'mixed' {
    const taxable = children.filter(c => c.taxType === 'standard' && (c.amount || 0) !== 0).length;
    const exempt = children.filter(c => c.taxType !== 'standard' && (c.amount || 0) !== 0).length;
    if (taxable > 0 && exempt > 0) return 'mixed';
    return exempt > 0 ? 'exempt' : 'taxable';
}

function setBorderBox(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number, color: string): void {
    for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
            const cell = ws.getCell(r, c);
            cell.border = {
                ...cell.border,
                top: r === r1 ? thin(color) : cell.border?.top,
                bottom: r === r2 ? thin(color) : cell.border?.bottom,
                left: c === c1 ? thin(color) : cell.border?.left,
                right: c === c2 ? thin(color) : cell.border?.right,
            };
        }
    }
}

function setupSheet(ws: ExcelJS.Worksheet): void {
    ws.views = [{ showGridLines: false }];
    ws.pageSetup = {
        paperSize: 9 as ExcelJS.PaperSize, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    };
    ws.headerFooter = { oddFooter: '&RNo. &P' };
    ws.getColumn(COL.no).width = 5;
    ws.getColumn(COL.name).width = 30;
    ws.getColumn(COL.spec).width = 30;
    ws.getColumn(COL.qty).width = 9;
    ws.getColumn(COL.unit).width = 7;
    ws.getColumn(COL.price).width = 12;
    ws.getColumn(COL.amount).width = 14;
    ws.getColumn(COL.remarks).width = 26;
}

/** 明細テーブルのヘッダー行 */
function writeTableHeader(ws: ExcelJS.Worksheet, row: number): void {
    const labels: Record<number, string> = {
        [COL.no]: '', [COL.name]: '名称', [COL.spec]: '規格', [COL.qty]: '数量',
        [COL.unit]: '単位', [COL.price]: '単価', [COL.amount]: '金額', [COL.remarks]: '備考',
    };
    ws.getRow(row).height = 20;
    for (let c = COL.no; c <= LAST_COL; c += 1) {
        const cell = ws.getCell(row, c);
        cell.value = labels[c];
        cell.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INFO_BG } };
        cell.border = { top: thin(BORDER_DARK), bottom: thin(BORDER_DARK), left: hair(BORDER_MEDIUM), right: hair(BORDER_MEDIUM) };
    }
}

/** 明細1行（通常行 / inline 見出し / detail カテゴリ行 / 内訳のカテゴリ見出し） */
function writeItemRow(
    ws: ExcelJS.Worksheet,
    row: number,
    no: number | null,
    item: EstimateItem,
    amount: ExcelJS.CellValue,
    opts: { bold?: boolean; hidePriceCols?: boolean } = {},
): void {
    ws.getRow(row).height = 18;
    const bold = opts.bold ?? false;
    const cells: [number, ExcelJS.CellValue, 'left' | 'center' | 'right'][] = [
        [COL.no, no ?? '', 'center'],
        [COL.name, item.description || '', 'left'],
        [COL.spec, opts.hidePriceCols ? '' : (item.specification || ''), 'left'],
        [COL.qty, item.quantity > 0 ? item.quantity : '', 'right'],
        [COL.unit, item.unit || '', 'center'],
        [COL.price, opts.hidePriceCols || !item.unitPrice ? '' : item.unitPrice, 'right'],
        [COL.amount, amount, 'right'],
        [COL.remarks, item.notes || '', 'left'],
    ];
    for (const [c, value, align] of cells) {
        const cell = ws.getCell(row, c);
        cell.value = value;
        cell.font = { name: FONT, size: 9, bold: bold && (c === COL.name || c === COL.amount) };
        cell.alignment = { horizontal: align, vertical: 'middle', shrinkToFit: c !== COL.amount };
        cell.border = { bottom: hair(BORDER_MEDIUM), left: hair(BORDER_MEDIUM), right: hair(BORDER_MEDIUM) };
        if (c === COL.qty) cell.numFmt = '#,##0.##';
        if (c === COL.price || c === COL.amount) cell.numFmt = YEN_FMT;
    }
}

/** 小計/消費税/合計の行（右寄せのラベル＋金額） */
function writeTotalRow(ws: ExcelJS.Worksheet, row: number, label: string, value: ExcelJS.CellValue, opts: { big?: boolean } = {}): void {
    ws.getRow(row).height = 20;
    for (let c = COL.no; c <= LAST_COL; c += 1) {
        const cell = ws.getCell(row, c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
        cell.border = { top: thin(BORDER_DARK), bottom: thin(BORDER_DARK), left: hair(BORDER_MEDIUM), right: hair(BORDER_MEDIUM) };
    }
    ws.mergeCells(row, COL.no, row, COL.unit);
    const labelCell = ws.getCell(row, COL.price);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: opts.big ? 10 : 9, bold: true };
    labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    const amountCell = ws.getCell(row, COL.amount);
    amountCell.value = value;
    amountCell.font = { name: FONT, size: opts.big ? 10 : 9, bold: true };
    amountCell.alignment = { horizontal: 'right', vertical: 'middle' };
    amountCell.numFmt = YEN_FMT_SIGN;
}

/** Base64 の data URL をロゴ/印鑑として貼る（png/jpeg 以外は無視） */
function addImageFromDataUrl(
    wb: ExcelJS.Workbook,
    ws: ExcelJS.Worksheet,
    dataUrl: string | undefined,
    position: { col: number; row: number; width: number; height: number },
): void {
    if (!dataUrl) return;
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
    if (!m) return;
    const extension = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
    const id = wb.addImage({ base64: m[2], extension });
    ws.addImage(id, {
        tl: { col: position.col, row: position.row },
        ext: { width: position.width, height: position.height },
        editAs: 'oneCell',
    });
}

export interface EstimateExcelOptions {
    includeDetails?: boolean;
    creatorName?: string;
}

export interface EstimateWorkbookResult {
    workbook: ExcelJS.Workbook;
    /** 検証用: 表紙の小計・消費税・合計セルの位置 */
    coverTotals: { subtotalCell: string; taxCell: string; totalCell: string };
    /** 消費税を式にできず値で入れたか（detail カテゴリ内で課税/非課税が混在） */
    taxAsValue: boolean;
}

/**
 * ブックを組み立てる（保存はしない）。検証スクリプトからも使う。
 */
export async function buildEstimateWorkbook(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: EstimateExcelOptions = { includeDetails: true },
): Promise<EstimateWorkbookResult> {
    const ExcelJSModule = await import('exceljs');
    const Excel = ExcelJSModule.default ?? ExcelJSModule;
    const wb = new Excel.Workbook();
    wb.creator = companyInfo.name || 'DandoLink';
    wb.created = new Date();

    const includeDetails = options.includeDetails ?? true;
    const estimateTitle = project.title || estimate.title;
    const detailCategories = estimate.items.filter(
        it => it.isCategory && it.categoryType !== 'inline' && (it.children ?? []).length > 0,
    );
    const hasCategories = detailCategories.length > 0;

    // 表紙シートを先頭に置くため最初に作る（中身は内訳シートの小計セル位置が決まってから書く）
    const cover = wb.addWorksheet('御見積書');
    setupSheet(cover);

    // ---------------------------------------------------------------- 内訳明細書（先に作って小計セルの位置を確定）
    const detailSubtotalRef = new Map<string, string>(); // categoryId → "'内訳明細書1'!G12"
    if (includeDetails && hasCategories) {
        detailCategories.forEach((category, index) => {
            const sheetName = `内訳明細書${index + 1}`;
            const ws = wb.addWorksheet(sheetName);
            setupSheet(ws);

            ws.mergeCells(1, COL.no, 1, COL.price);
            const t = ws.getCell(1, COL.no);
            t.value = '内 訳 明 細 書';
            t.font = { name: FONT, size: 14, bold: true };
            t.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getRow(1).height = 26;
            ws.mergeCells(1, COL.amount, 1, COL.remarks);
            const no = ws.getCell(1, COL.amount);
            no.value = `見積No. ${estimate.estimateNumber}`;
            no.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
            no.alignment = { horizontal: 'right', vertical: 'middle' };

            ws.mergeCells(2, COL.no, 2, COL.remarks);
            const sub = ws.getCell(2, COL.no);
            sub.value = `工事名称: ${estimateTitle}`;
            sub.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };

            const HEADER_ROW = 4;
            writeTableHeader(ws, HEADER_ROW);
            // カテゴリ見出し行（金額は子項目の合計式）
            const children = category.children ?? [];
            const firstChildRow = HEADER_ROW + 2;
            const lastChildRow = firstChildRow + Math.max(children.length, 1) - 1;
            const sumFormula = `SUM(G${firstChildRow}:G${lastChildRow})`;
            writeItemRow(ws, HEADER_ROW + 1, null, category, { formula: sumFormula, result: category.amount }, { bold: true, hidePriceCols: true });
            children.forEach((child, i) => {
                writeItemRow(ws, firstChildRow + i, i + 1, child, amountFormulaOrValue(child, firstChildRow + i));
            });
            if (children.length === 0) ws.getRow(firstChildRow).height = 18;
            const subtotalRow = lastChildRow + 1;
            writeTotalRow(ws, subtotalRow, '小計', { formula: sumFormula, result: category.amount });
            ws.pageSetup.printArea = `A1:${ws.getColumn(LAST_COL).letter}${subtotalRow}`;
            detailSubtotalRef.set(category.id, `'${sheetName}'!G${subtotalRow}`);
        });
    }

    // ---------------------------------------------------------------- 表紙
    // タイトル・見積日・見積No
    cover.getRow(1).height = 30;
    cover.mergeCells(1, COL.name, 1, COL.amount);
    const title = cover.getCell(1, COL.name);
    title.value = '御 見 積 書';
    title.font = { name: FONT, size: 18, bold: true };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    const dateCell = cover.getCell(1, COL.remarks);
    dateCell.value = `見積日　${toReiwa(new Date(estimate.createdAt))}`;
    dateCell.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
    dateCell.alignment = { horizontal: 'right', vertical: 'top' };
    const noCell = cover.getCell(2, COL.remarks);
    noCell.value = `見積No. ${estimate.estimateNumber}`;
    noCell.font = { name: FONT, size: 9 };
    noCell.alignment = { horizontal: 'right', vertical: 'middle' };

    // 宛名（A4:D4）＋挨拶文（A5:D7）
    cover.getRow(4).height = 28;
    cover.mergeCells(4, COL.no, 4, COL.qty);
    const customer = cover.getCell(4, COL.no);
    customer.value = `${project.customer || ''}　${project.customerHonorific || '御中'}`;
    customer.font = { name: FONT, size: 14, underline: true };
    customer.alignment = { vertical: 'middle', shrinkToFit: true };
    cover.mergeCells(5, COL.no, 7, COL.qty);
    const greeting = cover.getCell(5, COL.no);
    greeting.value = 'いつもお世話になっております。\n下記の通り御見積書をお送りいたしますので、\nご検討のほどよろしくお願いいたします。';
    greeting.font = { name: FONT, size: 9 };
    greeting.alignment = { vertical: 'top', wrapText: true };

    // 会社情報（F4〜F10）＋ロゴ・印鑑
    const companyLines: [string, Partial<ExcelJS.Font>][] = [
        [companyInfo.name, { size: 11, bold: true }],
    ];
    if (companyInfo.licenseNumber) companyLines.push([companyInfo.licenseNumber, { size: 8 }]);
    if (companyInfo.representativeTitle || companyInfo.representative) {
        companyLines.push([`${companyInfo.representativeTitle ? `${companyInfo.representativeTitle}　` : ''}${companyInfo.representative ?? ''}`, { size: 8 }]);
    }
    companyLines.push([`〒${companyInfo.postalCode}　${companyInfo.address}`, { size: 8 }]);
    companyLines.push([`TEL　${companyInfo.tel}　　FAX　${companyInfo.fax || ''}`, { size: 8 }]);
    if (companyInfo.email) companyLines.push([`e-mail　${companyInfo.email}`, { size: 8 }]);
    if (options.creatorName) companyLines.push([`担当　${options.creatorName}`, { size: 8 }]);
    companyLines.forEach(([text, font], i) => {
        const r = 4 + i;
        cover.mergeCells(r, COL.price, r, COL.remarks);
        const cell = cover.getCell(r, COL.price);
        cell.value = text;
        cell.font = { name: FONT, ...font };
        cell.alignment = { vertical: 'middle' };
    });
    // ロゴは会社名の上（3行目の右）・印鑑は会社名の右上に重ねる（PDF と同じ配置）
    addImageFromDataUrl(wb, cover, companyInfo.logoImage, { col: COL.price - 1, row: 2.1, width: 110, height: 30 });
    addImageFromDataUrl(wb, cover, companyInfo.sealImage, { col: COL.remarks - 0.55, row: 3.2, width: 46, height: 46 });

    // 合計金額（税込）／小計／消費税額
    const AMOUNT_ROW = 9;
    const amountLabel = cover.getCell(AMOUNT_ROW, COL.no);
    cover.mergeCells(AMOUNT_ROW, COL.no, AMOUNT_ROW, COL.name);
    amountLabel.value = '合計金額';
    amountLabel.font = { name: FONT, size: 11, bold: true };
    amountLabel.alignment = { vertical: 'middle' };
    cover.getRow(AMOUNT_ROW).height = 26;

    // ---- 明細（表紙用フラット展開） ----
    const INFO_FIRST_ROW = 13;
    const infoRows: [string, string][] = [
        ['件名', estimateTitle],
        ['現場住所', estimate.location || project.location || ''],
        ['有効期限', `発行日より${Math.max(1, Math.ceil((new Date(estimate.validUntil).getTime() - new Date(estimate.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)))}ヶ月`],
        ['工期', estimate.constructionPeriod || ''],
        ['支払条件', '従来通り'],
    ];
    infoRows.forEach(([label, value], i) => {
        const r = INFO_FIRST_ROW + i;
        cover.getRow(r).height = 18;
        const l = cover.getCell(r, COL.no);
        l.value = label;
        l.font = { name: FONT, size: 9 };
        l.alignment = { horizontal: 'center', vertical: 'middle' };
        l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INFO_BG } };
        cover.mergeCells(r, COL.name, r, COL.unit);
        const v = cover.getCell(r, COL.name);
        v.value = value;
        v.font = { name: FONT, size: 9 };
        v.alignment = { vertical: 'middle', shrinkToFit: true, indent: 1 };
    });
    setBorderBox(cover, INFO_FIRST_ROW, COL.no, INFO_FIRST_ROW + infoRows.length - 1, COL.unit, BORDER_MEDIUM);
    for (let i = 0; i < infoRows.length; i += 1) {
        const r = INFO_FIRST_ROW + i;
        cover.getCell(r, COL.no).border = { ...cover.getCell(r, COL.no).border, right: hair(BORDER_MEDIUM), bottom: hair(BORDER_MEDIUM) };
        cover.getCell(r, COL.name).border = { ...cover.getCell(r, COL.name).border, bottom: hair(BORDER_MEDIUM) };
    }
    // 備考（F13 見出し、F14:H17 本文）
    cover.mergeCells(INFO_FIRST_ROW, COL.price, INFO_FIRST_ROW, COL.remarks);
    const remarksHead = cover.getCell(INFO_FIRST_ROW, COL.price);
    remarksHead.value = '備考';
    remarksHead.font = { name: FONT, size: 9 };
    remarksHead.alignment = { horizontal: 'center', vertical: 'middle' };
    remarksHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INFO_BG } };
    const remarksLast = INFO_FIRST_ROW + infoRows.length - 1;
    cover.mergeCells(INFO_FIRST_ROW + 1, COL.price, remarksLast, COL.remarks);
    const remarksBody = cover.getCell(INFO_FIRST_ROW + 1, COL.price);
    remarksBody.value = estimate.notes || '';
    remarksBody.font = { name: FONT, size: 9 };
    remarksBody.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    setBorderBox(cover, INFO_FIRST_ROW, COL.price, remarksLast, COL.remarks, BORDER_MEDIUM);

    const TABLE_HEADER_ROW = remarksLast + 2;
    writeTableHeader(cover, TABLE_HEADER_ROW);
    const coverRows = flattenForCover(estimate.items);
    const firstItemRow = TABLE_HEADER_ROW + 1;
    // PDF の表紙は12行固定。Excel は全項目を出すが、少ないときは12行ぶんの枠を保つ
    const rowsToWrite = Math.max(coverRows.length, 12);
    const subtotalTerms: string[] = [];
    const taxableTerms: string[] = [];
    let taxMixed = false;
    let no = 0;
    for (let i = 0; i < rowsToWrite; i += 1) {
        const r = firstItemRow + i;
        const cr = coverRows[i];
        if (!cr) {
            writeItemRow(cover, r, null, { id: '', description: '', quantity: 0, unitPrice: 0, amount: 0, taxType: 'standard' }, '');
            continue;
        }
        no += 1;
        const { item } = cr;
        if (cr.inlineHeader) {
            // 見出し行の金額は直後の子項目の合計（表示のみ・小計には入れない）
            const childFirst = r + 1;
            const childLast = r + Math.max(cr.childCount, 1);
            const value: ExcelJS.CellValue = cr.childCount > 0
                ? { formula: `SUM(G${childFirst}:G${childLast})`, result: item.amount }
                : '';
            writeItemRow(cover, r, no, item, value, { bold: true, hidePriceCols: true });
            continue;
        }
        if (cr.detailCategory) {
            const ref = detailSubtotalRef.get(item.id);
            const value: ExcelJS.CellValue = ref ? { formula: ref, result: item.amount } : item.amount;
            writeItemRow(cover, r, no, item, value, { bold: true, hidePriceCols: true });
            subtotalTerms.push(`G${r}`);
            const kind = categoryTaxKind(item.children ?? []);
            if (kind === 'taxable') taxableTerms.push(`G${r}`);
            else if (kind === 'mixed') taxMixed = true;
            continue;
        }
        writeItemRow(cover, r, no, item, amountFormulaOrValue(item, r));
        subtotalTerms.push(`G${r}`);
        if (item.taxType === 'standard') taxableTerms.push(`G${r}`);
    }
    const lastItemRow = firstItemRow + rowsToWrite - 1;
    // 最終行の下罫線は濃く
    for (let c = COL.no; c <= LAST_COL; c += 1) {
        const cell = cover.getCell(lastItemRow, c);
        cell.border = { ...cell.border, bottom: thin(BORDER_DARK) };
    }

    const SUBTOTAL_ROW = lastItemRow + 1;
    const TAX_ROW = SUBTOTAL_ROW + 1;
    const TOTAL_ROW = TAX_ROW + 1;
    const subtotalFormula = subtotalTerms.length > 0 ? subtotalTerms.join('+') : '0';
    writeTotalRow(cover, SUBTOTAL_ROW, '小計', { formula: subtotalFormula, result: estimate.subtotal });
    const taxAsValue = taxMixed;
    const taxValue: ExcelJS.CellValue = taxAsValue
        ? estimate.tax
        : { formula: `ROUNDDOWN((${taxableTerms.length > 0 ? taxableTerms.join('+') : '0'})*${TAX_RATE},0)`, result: estimate.tax };
    writeTotalRow(cover, TAX_ROW, '消費税額(10%)', taxValue);
    writeTotalRow(cover, TOTAL_ROW, '合計金額（税込）', { formula: `G${SUBTOTAL_ROW}+G${TAX_ROW}`, result: estimate.total }, { big: true });

    // 上部の合計ブロックは明細の合計行を参照する
    const bigAmount = cover.getCell(AMOUNT_ROW, COL.spec);
    bigAmount.value = { formula: `G${TOTAL_ROW}`, result: estimate.total };
    bigAmount.font = { name: FONT, size: 16, bold: true };
    bigAmount.numFmt = YEN_FMT_SIGN;
    bigAmount.alignment = { horizontal: 'right', vertical: 'middle' };
    const taxNote = cover.getCell(AMOUNT_ROW, COL.qty);
    taxNote.value = '（税込）';
    taxNote.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
    taxNote.alignment = { vertical: 'middle' };
    const subRows: [string, string][] = [['小計', `G${SUBTOTAL_ROW}`], ['消費税額(10%)', `G${TAX_ROW}`]];
    subRows.forEach(([label, ref], i) => {
        const r = AMOUNT_ROW + 1 + i;
        cover.getRow(r).height = 16;
        const l = cover.getCell(r, COL.name);
        l.value = label;
        l.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
        l.alignment = { horizontal: 'right', vertical: 'middle' };
        const v = cover.getCell(r, COL.spec);
        v.value = { formula: ref, result: i === 0 ? estimate.subtotal : estimate.tax };
        v.font = { name: FONT, size: 9 };
        v.numFmt = YEN_FMT_SIGN;
        v.alignment = { horizontal: 'right', vertical: 'middle' };
    });
    // 合計ブロックの下線（PDF の amountSection の区切り）
    for (let c = COL.no; c <= COL.qty; c += 1) {
        const cell = cover.getCell(AMOUNT_ROW, c);
        cell.border = { ...cell.border, bottom: thin(BORDER_DARK) };
    }
    cover.pageSetup.printArea = `A1:${cover.getColumn(LAST_COL).letter}${TOTAL_ROW}`;
    cover.pageSetup.printTitlesRow = `${TABLE_HEADER_ROW}:${TABLE_HEADER_ROW}`;

    // ---------------------------------------------------------------- 見積内訳明細書（detail カテゴリが無いとき）
    if (includeDetails && !hasCategories) {
        const ws = wb.addWorksheet('見積内訳明細書');
        setupSheet(ws);
        ws.mergeCells(1, COL.no, 1, COL.price);
        const t = ws.getCell(1, COL.no);
        t.value = '見積内訳明細書';
        t.font = { name: FONT, size: 14, bold: true };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 26;
        ws.mergeCells(1, COL.amount, 1, COL.remarks);
        const n = ws.getCell(1, COL.amount);
        n.value = `見積No. ${estimate.estimateNumber}`;
        n.font = { name: FONT, size: 9, color: { argb: TEXT_SECONDARY } };
        n.alignment = { horizontal: 'right', vertical: 'middle' };

        const HEADER_ROW = 3;
        writeTableHeader(ws, HEADER_ROW);
        const flat: { item: EstimateItem; header: boolean }[] = [];
        for (const item of estimate.items) {
            flat.push({ item, header: !!item.isCategory });
            if (item.isCategory) for (const child of item.children ?? []) flat.push({ item: child, header: false });
        }
        const terms: string[] = [];
        const taxTerms: string[] = [];
        flat.forEach((f, i) => {
            const r = HEADER_ROW + 1 + i;
            if (f.header) {
                const childCount = f.item.children?.length ?? 0;
                const value: ExcelJS.CellValue = childCount > 0
                    ? { formula: `SUM(G${r + 1}:G${r + childCount})`, result: f.item.amount }
                    : '';
                writeItemRow(ws, r, i + 1, f.item, value, { bold: true, hidePriceCols: true });
            } else {
                writeItemRow(ws, r, i + 1, f.item, amountFormulaOrValue(f.item, r));
                terms.push(`G${r}`);
                if (f.item.taxType === 'standard') taxTerms.push(`G${r}`);
            }
        });
        const last = HEADER_ROW + Math.max(flat.length, 1);
        const sRow = last + 1;
        writeTotalRow(ws, sRow, '小計', { formula: terms.length > 0 ? terms.join('+') : '0', result: estimate.subtotal });
        writeTotalRow(ws, sRow + 1, '消費税', { formula: `ROUNDDOWN((${taxTerms.length > 0 ? taxTerms.join('+') : '0'})*${TAX_RATE},0)`, result: estimate.tax });
        writeTotalRow(ws, sRow + 2, '合計', { formula: `G${sRow}+G${sRow + 1}`, result: estimate.total }, { big: true });
        ws.pageSetup.printArea = `A1:${ws.getColumn(LAST_COL).letter}${sRow + 2}`;
    }

    return {
        workbook: wb,
        coverTotals: { subtotalCell: `G${SUBTOTAL_ROW}`, taxCell: `G${TAX_ROW}`, totalCell: `G${TOTAL_ROW}` },
        taxAsValue,
    };
}

/** 見積書を Excel（.xlsx）で保存する。PDF の exportEstimatePDFReact と同じ引数 */
export async function exportEstimateExcel(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: EstimateExcelOptions = { includeDetails: true },
): Promise<void> {
    try {
        const { workbook } = await buildEstimateWorkbook(estimate, project, companyInfo, options);
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: XLSX_MIME });
        const titlePart = sanitizeFileName(estimate.title || estimate.estimateNumber) || estimate.estimateNumber;
        await saveBlobWithShare(blob, `${titlePart}.xlsx`, XLSX_MIME, '見積書をお送りします');
    } catch (error) {
        logger.error('見積書Excel生成エラー:', error);
        throw error;
    }
}
