/**
 * 受注明細書（信用保証協会様式）Excel のブック組み立て。
 *
 * 方式: public/templates/order-backlog-template.xlsx（提出済みシートから作った1シートのテンプレ）を
 * ZIP のまま開き、シートXMLの**セルの中身だけ**を差し替える。
 * s属性（スタイル）・結合セル・列幅・行高・印刷設定（A3横61%）は一切触らないので、
 * 見た目は提出済みシートと完全に一致する。数式は書かず、計算済みの値だけを入れる
 * （テンプレの H 列にあった `=E*G`・62行目の SUM は生成時に除去済み）。
 *
 * ブラウザ・Node の双方から使えるよう、このモジュールは DOM API と react-pdf に依存しない。
 * （テンプレのバイト列は呼び出し側が用意する＝サーバーは fs、画面は fetch）
 */
import { ROWS_PER_PAGE } from '@/lib/orderBacklog/types';
import type { OrderBacklogSheet, RenderRow } from '@/lib/orderBacklog/render';
import {
    EMPTY,
    buildWorkbookFromTemplate,
    num,
    openXlsxTemplate,
    sanitizeSheetName,
    setCells,
    text,
    type CellValue,
} from '@/utils/xlsxTemplate';

/** 明細の先頭行（枠 i の上段 = FIRST_DETAIL_ROW + 2i、下段はその次の行） */
const FIRST_DETAIL_ROW = 10;
/** 「計」の行 */
const TOTAL_ROW = 62;
/** 入金予定の9列（基準月 m 〜 m+7 と「m+8月以降」） */
const SCHEDULE_COLUMNS = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;
/** 入金予定の月見出しの行（書式 `0"月"` / S列だけ `0"月以降"` なので数値を書く） */
const MONTH_HEADER_ROW = 9;
/** 基準日ラベル（F5:J5 結合） */
const AS_OF_CELL = 'F5';
/** 申込人（B6:E7 結合） */
const APPLICANT_CELL = 'B6';
/** 1枚目のシート名（2枚目以降は「受注明細書(2)」…） */
const DEFAULT_SHEET_NAME = '受注明細書';

/**
 * 申込人欄の字数（テンプレの B6 =「申込人」＋全角空白36個 と同じ長さ）。
 *
 * B6 のフォントは下線付きなので、この字数ぶんの全角空白が
 * 「申込人名を手書きするための罫線」になっている。名前が短くても罫線の長さが
 * 変わらないよう、書き込む文字列を全角空白で同じ長さまで埋める。
 */
const APPLICANT_LABEL_LENGTH = 39;
const IDEOGRAPHIC_SPACE = '　';

/** 0 は書かない（提出済みシートは未入力セルが空欄）。計だけは 0 でも書く。 */
const numOrEmpty = (value: number | undefined): CellValue =>
    value ? num(value) : EMPTY;

const textOrEmptyCell = (value: string | undefined): CellValue =>
    value ? text(value) : EMPTY;

/** 申込人欄をテンプレと同じ字数まで全角空白で埋める（下線＝手書き罫線の長さを保つ） */
export function padApplicantLabel(label: string): string {
    if (label.length >= APPLICANT_LABEL_LENGTH) return label;
    return label + IDEOGRAPHIC_SPACE.repeat(APPLICANT_LABEL_LENGTH - label.length);
}

/** 明細1枠ぶん（上段 r・下段 r+1）に書き込むセル */
function detailCells(row: RenderRow, r: number): Record<string, CellValue> {
    const cells: Record<string, CellValue> = {
        [`B${r}`]: num(row.code),
        [`C${r}`]: textOrEmptyCell(row.top),
        [`C${r + 1}`]: textOrEmptyCell(row.bottom),
        [`E${r}`]: numOrEmpty(row.contractK),
        // 区分行（集約）は着工・完成・出来高が無い＝空欄のまま
        [`F${r}`]: textOrEmptyCell(row.startYm),
        [`F${r + 1}`]: textOrEmptyCell(row.endYm),
        [`G${r}`]: numOrEmpty(row.progressRate),
        [`H${r}`]: numOrEmpty(row.progressAmountK),
        [`I${r}`]: numOrEmpty(row.receivedK),
        [`J${r}`]: numOrEmpty(row.unreceivedK),
    };
    SCHEDULE_COLUMNS.forEach((col, i) => {
        cells[`${col}${r}`] = numOrEmpty(row.scheduleK[i]);
    });
    return cells;
}

/**
 * テンプレのシートXMLに1ページぶん（最大26枠）の値を書き込む。
 *
 * テンプレは行10〜62 の値を消してあるので、埋めなかった枠は空欄のまま残る。
 * withTotals は最終ページだけ true（「計」は最後のシートにしか出さない）。
 */
export function fillOrderBacklogSheetXml(
    templateSheetXml: string,
    sheet: OrderBacklogSheet,
    rows: readonly RenderRow[],
    { withTotals }: { withTotals: boolean }
): string {
    let xml = templateSheetXml;

    // --- 見出し（基準日・申込人・入金予定の月）
    const headerCells: Record<string, CellValue> = {
        [AS_OF_CELL]: textOrEmptyCell(sheet.asOfLabel),
        [APPLICANT_CELL]: text(padApplicantLabel(sheet.applicantLabel)),
    };
    SCHEDULE_COLUMNS.forEach((col, i) => {
        const column = sheet.columns[i];
        headerCells[`${col}${MONTH_HEADER_ROW}`] = column ? num(column.monthNumber) : EMPTY;
    });
    xml = setCells(xml, headerCells);

    // --- 明細（枠 i の上段 = 10 + 2i）
    rows.slice(0, ROWS_PER_PAGE).forEach((row, i) => {
        xml = setCells(xml, detailCells(row, FIRST_DETAIL_ROW + i * 2));
    });

    // --- 計（最終シートのみ・0 でも書く＝合計欄が空だと未記入に見えるため）
    if (withTotals) {
        const { totals } = sheet;
        const totalCells: Record<string, CellValue> = {
            [`B${TOTAL_ROW}`]: text('計'),
            [`E${TOTAL_ROW}`]: num(totals.contractK),
            [`I${TOTAL_ROW}`]: num(totals.receivedK),
            [`J${TOTAL_ROW}`]: num(totals.unreceivedK),
        };
        SCHEDULE_COLUMNS.forEach((col, i) => {
            totalCells[`${col}${TOTAL_ROW}`] = num(totals.scheduleK[i] ?? 0);
        });
        xml = setCells(xml, totalCells);
    }

    return xml;
}

/** 2枚目以降のシート名（受注明細書 / 受注明細書(2) / 受注明細書(3) …） */
export function orderBacklogSheetName(baseName: string, index: number): string {
    return sanitizeSheetName(index === 0 ? baseName : `${baseName}(${index + 1})`, DEFAULT_SHEET_NAME);
}

/**
 * テンプレ xlsx のバイト列と出力用の行（buildOrderBacklogSheet の戻り）から xlsx を組み立てる。
 * 26枠を超えたぶんはシートを複製して 2枚目・3枚目…に載せる（符号は通し番号のまま）。
 */
export async function buildOrderBacklogWorkbook(
    templateBytes: Uint8Array | Buffer,
    sheet: OrderBacklogSheet,
    opts: { sheetName?: string } = {}
): Promise<Uint8Array> {
    const template = await openXlsxTemplate(templateBytes);
    const baseName = opts.sheetName?.trim() || DEFAULT_SHEET_NAME;
    // rows が 0 件でも様式1枚は出す（buildOrderBacklogSheet が空ページを1つ返す）
    const pages = sheet.pages.length > 0 ? sheet.pages : [[]];

    const buffer = await buildWorkbookFromTemplate(
        template,
        pages.map((rows, index) => ({
            name: orderBacklogSheetName(baseName, index),
            xml: fillOrderBacklogSheetXml(template.baseSheetXml, sheet, rows, {
                withTotals: index === pages.length - 1,
            }),
        }))
    );
    return new Uint8Array(buffer);
}
