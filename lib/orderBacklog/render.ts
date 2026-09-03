import { toReiwaYear } from '@/lib/closingDay';
import { aggregateBuckets, bucketBottomLabel, bucketTopLabel } from '@/lib/orderBacklog/buckets';
import {
    ROWS_PER_PAGE,
    SCHEDULE_COLUMN_COUNT,
    type OrderBacklogLineInput,
    type OrderBacklogReportInput,
    type ScheduleMap,
} from '@/lib/orderBacklog/types';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' / 'YYYY-MM' → 'YYYY-MM'。（propose.ts とも共用） */
export function ymOf(value: string): string {
    return value.slice(0, 7);
}

/** 'YYYY-MM' に月を足す（年跨ぎは Date.UTC の正規化に任せる）。 */
export function ymAdd(ym: string, months: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** a − b を月数で返す（a が後なら正）。 */
export function ymDiff(a: string, b: string): number {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return (ay - by) * 12 + (am - bm);
}

/** 'YYYY-MM' → '2026/5'（様式の着工・完成予定の表記）。 */
export function ymToSlash(ym: string | null | undefined): string | undefined {
    if (!ym) return undefined;
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return undefined;
    return `${y}/${m}`;
}

/** 円 → 千円（様式は「単位　千円」）。 */
export function toThousands(yen: number): number {
    return Math.round(yen / 1000);
}

/** 入金予定の列（基準月 m 〜 m+7 ＋「m+8月以降」の 9 列）。 */
export interface MonthColumn {
    /** ScheduleMap のキー。最終列だけ 'later' */
    key: string;
    /** 1〜12（Excel の書式 `0"月"` に入れる数値） */
    monthNumber: number;
    label: string;
}

/** 基準日から入金予定の 9 列を作る（12 月の次は 1 月に巻き戻る）。 */
export function monthColumns(asOf: string): MonthColumn[] {
    const base = ymOf(asOf);
    const columns: MonthColumn[] = [];
    for (let i = 0; i < SCHEDULE_COLUMN_COUNT; i++) {
        const ym = ymAdd(base, i);
        const monthNumber = Number(ym.slice(5, 7));
        const isLast = i === SCHEDULE_COLUMN_COUNT - 1;
        columns.push({
            key: isLast ? 'later' : ym,
            monthNumber,
            label: isLast ? `${monthNumber}月以降` : `${monthNumber}月`,
        });
    }
    return columns;
}

/** '2026-06-01' → '（令和8年6月1日現在）'（様式 F5 の見出し）。 */
export function toReiwaAsOfLabel(asOfDate: string): string {
    const [y, m, d] = asOfDate.split('-').map(Number);
    return `（令和${toReiwaYear(y)}年${m}月${d}日現在）`;
}

/** 申込人の見出し（B6）。名前が無ければ全角空白だけ＝様式に手書きする運用。 */
export function applicantLabel(applicantName: string | null | undefined): string {
    return `申込人　${(applicantName ?? '').trim()}`;
}

/** 出力1行（様式の1枠＝2行ぶん）。金額は全て千円。 */
export interface RenderRow {
    kind: 'project' | 'bucket';
    /** 符号（1〜） */
    code: number;
    /** 上段（契約先 / 区分の見出し） */
    top: string;
    /** 下段（工事名 / 金額帯） */
    bottom: string;
    contractK: number;
    /** '2026/5'。区分行は undefined（空欄） */
    startYm?: string;
    endYm?: string;
    /** 0〜1（Excel の書式 `0%`）。区分行は undefined */
    progressRate?: number;
    progressAmountK?: number;
    receivedK: number;
    unreceivedK: number;
    /** 9列（monthColumns と同じ並び） */
    scheduleK: number[];
}

/** 計（行62）。 */
export interface OrderBacklogTotals {
    contractK: number;
    receivedK: number;
    unreceivedK: number;
    scheduleK: number[];
}

export interface OrderBacklogSheet {
    asOfLabel: string;
    applicantLabel: string;
    columns: MonthColumn[];
    rows: RenderRow[];
    /** 26枠ずつに分けたページ。計は最終ページにだけ出す */
    pages: RenderRow[][];
    totals: OrderBacklogTotals;
    /** 契約額が 0 のため出力から落とした明細の数（除外チェック済みは数えない）。画面で知らせる用 */
    omittedNoAmountCount: number;
}

/** buildOrderBacklogSheet が使う設定（保存済みレポートでも未保存の編集中でも渡せる形）。 */
export type OrderBacklogSheetReport = Pick<
    OrderBacklogReportInput,
    'asOfDate' | 'individualThreshold' | 'unreceivedMode'
> & { applicantName?: string | null };

/**
 * ScheduleMap（円）を 9 列（千円）に振り分ける。
 * 基準月より前のキーは第1列へ、基準月+8 以降と 'later' は最終列へ寄せる
 * （様式の最終列が「m+8月以降」なので、そこから溢れる先が無い）。
 * 円で足してから丸める＝列の合計と表示値がずれない。
 */
function scheduleToColumns(schedule: ScheduleMap | null | undefined, baseYm: string): number[] {
    const yen = new Array<number>(SCHEDULE_COLUMN_COUNT).fill(0);
    const lastIndex = SCHEDULE_COLUMN_COUNT - 1;
    for (const [key, amount] of Object.entries(schedule ?? {})) {
        if (!amount) continue;
        if (key === 'later') {
            yen[lastIndex] += amount;
            continue;
        }
        const diff = ymDiff(ymOf(key), baseYm);
        const index = diff <= 0 ? 0 : Math.min(diff, lastIndex);
        yen[index] += amount;
    }
    return yen.map(toThousands);
}

/**
 * 保存された明細を、Excel と PDF が共通で使う出力用の行に組み立てる。
 *
 * 並びは 個別行（契約額の降順・同額は sortOrder）→ 区分行（ORDER_BACKLOG_BUCKETS の順）。
 * 個別行の出来高金額・未受領は **千円ベース** で計算する（Excel の `=E*G` と同じ値になるように）。
 * 契約額が 0 の行は銀行に出す金額が無いので出力から落とし、件数だけ omittedNoAmountCount に残す
 * （候補には載せて入力を促す＝kei 2026-09-04。区分の「N件」にも数えない）。
 */
export function buildOrderBacklogSheet(
    report: OrderBacklogSheetReport,
    lines: readonly OrderBacklogLineInput[],
): OrderBacklogSheet {
    const baseYm = ymOf(report.asOfDate);
    const columns = monthColumns(report.asOfDate);
    const omittedNoAmountCount = lines.filter((l) => !l.excluded && l.contractAmount <= 0).length;
    const printable = lines.filter((l) => l.contractAmount > 0);
    const { individual, buckets } = aggregateBuckets(printable, {
        individualThreshold: report.individualThreshold,
        unreceivedMode: report.unreceivedMode,
    });

    const sorted = [...individual].sort(
        (a, b) => b.contractAmount - a.contractAmount || a.sortOrder - b.sortOrder,
    );

    const rows: RenderRow[] = [];

    for (const line of sorted) {
        const contractK = toThousands(line.contractAmount);
        const rate = line.progressRate / 100;
        const progressAmountK = Math.round(contractK * rate);
        const receivedK = toThousands(line.receivedAmount);
        rows.push({
            kind: 'project',
            code: rows.length + 1,
            top: line.customerName,
            bottom: line.projectName,
            contractK,
            startYm: ymToSlash(line.startYm),
            endYm: ymToSlash(line.endYm),
            progressRate: rate,
            progressAmountK,
            receivedK,
            unreceivedK:
                report.unreceivedMode === 'unpaid'
                    ? progressAmountK - receivedK
                    : contractK - progressAmountK,
            scheduleK: scheduleToColumns(line.schedule, baseYm),
        });
    }

    for (const bucket of buckets) {
        rows.push({
            kind: 'bucket',
            code: rows.length + 1,
            top: bucketTopLabel(bucket.key, bucket.count),
            bottom: bucketBottomLabel(bucket.key),
            contractK: toThousands(bucket.contractAmount),
            receivedK: toThousands(bucket.receivedAmount),
            unreceivedK: toThousands(bucket.unreceivedAmount),
            scheduleK: scheduleToColumns(bucket.schedule, baseYm),
        });
    }

    // 計は「表示している千円の合計」＝Excel の SUM と一致させる
    const totals: OrderBacklogTotals = {
        contractK: rows.reduce((s, r) => s + r.contractK, 0),
        receivedK: rows.reduce((s, r) => s + r.receivedK, 0),
        unreceivedK: rows.reduce((s, r) => s + r.unreceivedK, 0),
        scheduleK: columns.map((_, i) => rows.reduce((s, r) => s + (r.scheduleK[i] ?? 0), 0)),
    };

    const pages: RenderRow[][] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
        pages.push(rows.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    return {
        asOfLabel: toReiwaAsOfLabel(report.asOfDate),
        applicantLabel: applicantLabel(report.applicantName),
        columns,
        rows,
        pages,
        totals,
        omittedNoAmountCount,
    };
}
