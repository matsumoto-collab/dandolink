/**
 * 過去データ CSV（4 ファイル）の検査と、取り込める形への変換。純粋関数（DB に触らない）。
 *
 *   import_1_案件.csv      案件ID,現場名,顧客,出典,初日,最終日,非現場
 *   import_2_売上.csv      案件ID,請求日,金額税抜,顧客,元の現場名,出典
 *   import_3_作業履歴.csv  案件ID,作業日,職長,人数,区分,人数補完,元の現場名,元請
 *   import_4_売上調整.csv  顧客,年月,調整額税抜,売上入金表,請求書PDF
 *
 * 行ごとの externalKey（再取り込みの突き合わせキー）もここで決める。同じ組み合わせが複数行ある
 * （同じ案件・同じ請求日の分割請求、同じ日に同じ職長が 2 回入った等）ので、ファイル内の出現順で
 * 連番を付ける。連番は同じ組み合わせの中だけの順番なので、ほかの行が増減してもずれない。
 */
import { csvToRecords } from './csv';
import { BACKFILL_DATA_SOURCES, LIVE_DATA_START_MONTH, type BackfillDataSource } from './constants';

export type BackfillFileKind = 'projects' | 'sales' | 'works' | 'adjustments';

export const BACKFILL_FILE_LABELS: Record<BackfillFileKind, string> = {
    projects: 'import_1_案件.csv',
    sales: 'import_2_売上.csv',
    works: 'import_3_作業履歴.csv',
    adjustments: 'import_4_売上調整.csv',
};

export const BACKFILL_HEADERS: Record<BackfillFileKind, string[]> = {
    projects: ['案件ID', '現場名', '顧客', '出典', '初日', '最終日', '非現場'],
    sales: ['案件ID', '請求日', '金額税抜', '顧客', '元の現場名', '出典'],
    works: ['案件ID', '作業日', '職長', '人数', '区分', '人数補完', '元の現場名', '元請'],
    adjustments: ['顧客', '年月', '調整額税抜', '売上入金表', '請求書PDF'],
};

export interface BackfillIssue {
    file: BackfillFileKind;
    /** CSV の行番号（見出し行 = 1）。ファイル全体の問題は 0 */
    line: number;
    message: string;
}

export interface BackfillProjectRow {
    line: number;
    /** 案件ID（H00001）。そのまま ProjectMaster.externalKey になる */
    externalKey: string;
    siteName: string;
    customer: string;
    dataSource: BackfillDataSource;
    firstDate: string;
    lastDate: string;
    isNonSite: boolean;
}

export interface BackfillSaleRow {
    line: number;
    externalKey: string;
    projectKey: string;
    billedOn: string;
    amountExclTax: number;
    customer: string;
    originalSiteName: string;
    source: string;
}

export interface BackfillWorkRow {
    line: number;
    externalKey: string;
    projectKey: string;
    workedOn: string;
    foreman: string;
    /** CSV に書かれていた人数（外注の行も書かれている） */
    originalHeadcount: number;
    category: '自社' | '外注';
    /** 段取日報で空欄だった人数を直前の同じ職長から補完した行 */
    headcountFilled: boolean;
    originalSiteName: string;
    primeContractor: string;
}

export interface BackfillAdjustmentRow {
    line: number;
    externalKey: string;
    customer: string;
    yearMonth: string;
    amountExclTax: number;
    ledgerAmountExclTax: number | null;
    invoiceAmountExclTax: number | null;
}

export interface ParsedBackfill {
    projects: BackfillProjectRow[];
    sales: BackfillSaleRow[];
    works: BackfillWorkRow[];
    adjustments: BackfillAdjustmentRow[];
    errors: BackfillIssue[];
    warnings: BackfillIssue[];
}

export interface BackfillFileTexts {
    projects: string;
    sales: string;
    works: string;
    adjustments: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-\d{2}$/;
const INT_RE = /^-?\d+$/;

function isValidDate(ymd: string): boolean {
    if (!DATE_RE.test(ymd)) return false;
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidYearMonth(ym: string): boolean {
    if (!YM_RE.test(ym)) return false;
    const m = Number(ym.slice(5, 7));
    return m >= 1 && m <= 12;
}

/** 同じ組み合わせの中での出現順（1 始まり）を付けて externalKey を作る */
function makeKeyer() {
    const seen = new Map<string, number>();
    return (base: string): string => {
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return `${base}-${n}`;
    };
}

function checkHeaders(kind: BackfillFileKind, headers: string[], errors: BackfillIssue[]): boolean {
    const expected = BACKFILL_HEADERS[kind];
    const missing = expected.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
        errors.push({
            file: kind,
            line: 1,
            message: `見出しに ${missing.join('・')} がありません（${BACKFILL_FILE_LABELS[kind]} の見出しは「${expected.join(',')}」）`,
        });
        return false;
    }
    return true;
}

/**
 * 4 ファイルを検査して取り込める形にする。
 * errors が 1 件でもあれば取り込みはできない（ドライランでエラー行として見せる）。
 * warnings は取り込みはできるが確認してほしいもの。
 */
export function parseBackfillFiles(texts: BackfillFileTexts): ParsedBackfill {
    const errors: BackfillIssue[] = [];
    const warnings: BackfillIssue[] = [];
    const projects: BackfillProjectRow[] = [];
    const sales: BackfillSaleRow[] = [];
    const works: BackfillWorkRow[] = [];
    const adjustments: BackfillAdjustmentRow[] = [];

    // 過去データは DandoLink のデータで数え始める月より前でなければならない（二重計上になるため）
    const beforeLive = (ymd: string) => ymd.slice(0, 7) < LIVE_DATA_START_MONTH;

    // ---- 1. 案件 ------------------------------------------------------------
    const p = csvToRecords(texts.projects);
    const projectKeys = new Set<string>();
    if (checkHeaders('projects', p.headers, errors)) {
        for (const { line, values: v } of p.records) {
            const key = v['案件ID'];
            const issue = (message: string) => errors.push({ file: 'projects', line, message });
            if (!key) { issue('案件IDが空です'); continue; }
            if (projectKeys.has(key)) { issue(`案件ID ${key} が重複しています`); continue; }
            if (!v['現場名']) { issue(`${key}: 現場名が空です`); continue; }
            if (!(BACKFILL_DATA_SOURCES as readonly string[]).includes(v['出典'])) {
                issue(`${key}: 出典「${v['出典']}」は ${BACKFILL_DATA_SOURCES.join(' / ')} のどれでもありません`);
                continue;
            }
            if (!isValidDate(v['初日']) || !isValidDate(v['最終日'])) {
                issue(`${key}: 初日・最終日は YYYY-MM-DD で入れてください（初日「${v['初日']}」最終日「${v['最終日']}」）`);
                continue;
            }
            if (v['初日'] > v['最終日']) { issue(`${key}: 初日が最終日より後です`); continue; }
            if (v['非現場'] !== '' && v['非現場'] !== '該当') {
                issue(`${key}: 非現場は空欄か「該当」にしてください（「${v['非現場']}」）`);
                continue;
            }
            if (!beforeLive(v['初日'])) {
                issue(`${key}: 初日 ${v['初日']} が ${LIVE_DATA_START_MONTH} 以降です（その月から先は DandoLink のデータで数えるため取り込めません）`);
                continue;
            }
            projectKeys.add(key);
            projects.push({
                line,
                externalKey: key,
                siteName: v['現場名'],
                customer: v['顧客'],
                dataSource: v['出典'] as BackfillDataSource,
                firstDate: v['初日'],
                lastDate: v['最終日'],
                isNonSite: v['非現場'] === '該当',
            });
        }
    }

    // ---- 2. 売上 ------------------------------------------------------------
    const s = csvToRecords(texts.sales);
    if (checkHeaders('sales', s.headers, errors)) {
        const keyer = makeKeyer();
        for (const { line, values: v } of s.records) {
            const issue = (message: string) => errors.push({ file: 'sales', line, message });
            const projectKey = v['案件ID'];
            if (!projectKeys.has(projectKey)) { issue(`案件ID「${projectKey}」が案件CSVにありません`); continue; }
            if (!isValidDate(v['請求日'])) { issue(`${projectKey}: 請求日「${v['請求日']}」は YYYY-MM-DD で入れてください`); continue; }
            if (!INT_RE.test(v['金額税抜'])) { issue(`${projectKey}: 金額税抜「${v['金額税抜']}」が整数ではありません`); continue; }
            if (!beforeLive(v['請求日'])) { issue(`${projectKey}: 請求日 ${v['請求日']} が ${LIVE_DATA_START_MONTH} 以降です`); continue; }
            const amount = Number(v['金額税抜']);
            if (amount <= 0) warnings.push({ file: 'sales', line, message: `${projectKey}: 金額が ${amount} 円です` });
            sales.push({
                line,
                externalKey: keyer(`${projectKey}-${v['請求日']}`),
                projectKey,
                billedOn: v['請求日'],
                amountExclTax: amount,
                customer: v['顧客'],
                originalSiteName: v['元の現場名'],
                source: v['出典'],
            });
        }
    }

    // ---- 3. 作業履歴 ----------------------------------------------------------
    const w = csvToRecords(texts.works);
    if (checkHeaders('works', w.headers, errors)) {
        const keyer = makeKeyer();
        for (const { line, values: v } of w.records) {
            const issue = (message: string) => errors.push({ file: 'works', line, message });
            const projectKey = v['案件ID'];
            if (!projectKeys.has(projectKey)) { issue(`案件ID「${projectKey}」が案件CSVにありません`); continue; }
            if (!isValidDate(v['作業日'])) { issue(`${projectKey}: 作業日「${v['作業日']}」は YYYY-MM-DD で入れてください`); continue; }
            if (!/^\d+$/.test(v['人数'])) { issue(`${projectKey}: 人数「${v['人数']}」が 0 以上の整数ではありません`); continue; }
            if (v['区分'] !== '自社' && v['区分'] !== '外注') { issue(`${projectKey}: 区分「${v['区分']}」は 自社 か 外注 にしてください`); continue; }
            if (v['人数補完'] !== '0' && v['人数補完'] !== '1') { issue(`${projectKey}: 人数補完「${v['人数補完']}」は 0 か 1 にしてください`); continue; }
            if (!beforeLive(v['作業日'])) { issue(`${projectKey}: 作業日 ${v['作業日']} が ${LIVE_DATA_START_MONTH} 以降です`); continue; }
            works.push({
                line,
                // 職長まで含めておくと、同じ日の別の職長の行の並びが変わってもキーがずれない
                externalKey: keyer(`${projectKey}-${v['作業日']}-${v['職長'] || '-'}`),
                projectKey,
                workedOn: v['作業日'],
                foreman: v['職長'],
                originalHeadcount: Number(v['人数']),
                category: v['区分'] as '自社' | '外注',
                headcountFilled: v['人数補完'] === '1',
                originalSiteName: v['元の現場名'],
                primeContractor: v['元請'],
            });
        }
    }

    // ---- 4. 売上調整 -----------------------------------------------------------
    const a = csvToRecords(texts.adjustments);
    if (checkHeaders('adjustments', a.headers, errors)) {
        const seen = new Set<string>();
        for (const { line, values: v } of a.records) {
            const issue = (message: string) => errors.push({ file: 'adjustments', line, message });
            if (!v['顧客']) { issue('顧客が空です'); continue; }
            if (!isValidYearMonth(v['年月'])) { issue(`${v['顧客']}: 年月「${v['年月']}」は YYYY-MM で入れてください`); continue; }
            if (!INT_RE.test(v['調整額税抜'])) { issue(`${v['顧客']} ${v['年月']}: 調整額税抜「${v['調整額税抜']}」が整数ではありません`); continue; }
            if (v['年月'] >= LIVE_DATA_START_MONTH) { issue(`${v['顧客']}: 年月 ${v['年月']} が ${LIVE_DATA_START_MONTH} 以降です`); continue; }
            const key = `${v['顧客']}|${v['年月']}`;
            if (seen.has(key)) { issue(`${v['顧客']} ${v['年月']} が重複しています`); continue; }
            seen.add(key);
            const optInt = (x: string) => (INT_RE.test(x) ? Number(x) : null);
            adjustments.push({
                line,
                externalKey: key,
                customer: v['顧客'],
                yearMonth: v['年月'],
                amountExclTax: Number(v['調整額税抜']),
                ledgerAmountExclTax: optInt(v['売上入金表']),
                invoiceAmountExclTax: optInt(v['請求書PDF']),
            });
        }
    }

    // ---- ファイルをまたぐ確認 ------------------------------------------------
    // 「出典=請求書」は自社が入らず外注だけで施工した現場。自社人工があれば元データの取り違え
    const ownByProject = new Map<string, number>();
    for (const r of works) {
        if (r.category === '自社') ownByProject.set(r.projectKey, (ownByProject.get(r.projectKey) ?? 0) + r.originalHeadcount);
    }
    for (const pr of projects) {
        if (pr.dataSource === '請求書' && (ownByProject.get(pr.externalKey) ?? 0) > 0) {
            warnings.push({ file: 'projects', line: pr.line, message: `${pr.externalKey}: 出典=請求書 なのに自社人工が ${ownByProject.get(pr.externalKey)} あります` });
        }
    }

    return { projects, sales, works, adjustments, errors, warnings };
}
