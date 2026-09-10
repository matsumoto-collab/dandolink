/**
 * 工程表（A3横PDF）の目盛と工程バーの座標計算。
 *
 * 1案件＝「組立 / その他 / 解体」の3行で描く（手書きの工程表と同じ並び）。
 * 「その他」は組立・解体**以外のすべて**（二工程・搬入・夜勤・内部足場組立 など）。
 *
 * 横軸は表示日数で切り替える:
 *   ・134日以内 … 1日1目盛（A3横で1日あたり約7pt。日付が読める下限）
 *   ・それ以上   … 月ごとに 5/10/15/20/25/末 の6区切り
 *
 * バーの位置は列単位の実数（0 = 表の左端、1 = 目盛1つぶん）で返す。pt への換算は
 * PDF 側で「1列の幅」を掛けるだけにして、レイアウト定数をこのファイルに持ち込まない。
 */

/** 5日刻みにしたときの1ヶ月あたりの目盛数（5/10/15/20/25/末） */
export const CELLS_PER_MONTH = 6;

/**
 * 1日1目盛で描ける上限日数（約6ヶ月）。
 * A3横の目盛エリア（約914pt）を割ると 1日あたり約4.9pt になり、0.5pt の縦罫線でも
 * 日の区切りが判別できる下限。日付のラベルは幅に応じて PDF 側で間引く（5日ごと等）。
 * これを超えたら月ごとの5日刻みに落とす。
 *
 * 足場工事は「組立 → 数ヶ月空けて解体」が普通で、5〜10件並べると半年を超えることが
 * 多いため、日単位で粘れる範囲をなるべく広く取っている。
 */
export const MAX_DAY_SCALE_DAYS = 185;

export type ScheduleChartScale = 'day' | 'fiveDay';

/** 工程行の種別。並び順もこの順（組立 → その他 → 解体） */
export const WORK_CATEGORIES = [
    { key: 'assembly', label: '組立', defaultColor: '#a8c8e8' },
    { key: 'other', label: 'その他', defaultColor: '#fef08a' },
    { key: 'demolition', label: '解体', defaultColor: '#f0a8a8' },
] as const;

export type WorkCategoryKey = (typeof WORK_CATEGORIES)[number]['key'];

/**
 * 工事種別を工程行に振り分ける。
 * 「組立」「解体」ちょうどの2つだけを専用行にし、残り（内部足場組立・二工程・搬入など）は
 * すべて「その他」に入れる＝kei の指定「その他というのは組立、解体以外の全て」。
 */
export function classifyConstructionType(name: string | null | undefined): WorkCategoryKey {
    const trimmed = (name ?? '').trim();
    if (trimmed === '組立') return 'assembly';
    if (trimmed === '解体') return 'demolition';
    return 'other';
}

export interface ScheduleChartWorkEntry {
    /** 'YYYY-MM-DD' */
    date: string;
    constructionTypeId: string | null;
}

export interface ScheduleChartInputProject {
    projectMasterId: string;
    /** 現場名の列に出す文字列 */
    label: string;
    workEntries: ScheduleChartWorkEntry[];
}

export interface ScheduleChartConstructionTypeInput {
    id: string;
    name: string;
    color: string;
}

export interface ScheduleChartMonth {
    /** 'YYYY-MM' */
    key: string;
    /** 見出し（例: '9月'）。年が変わる月は '2027年1月' */
    label: string;
    /** この月が占める目盛の数 */
    cellCount: number;
    /** 目盛のラベル（日単位は 1,2,3…／5日刻みは 5,10,15,20,25,末日） */
    cellLabels: string[];
}

export interface ScheduleChartBar {
    /** 列座標（左端） */
    start: number;
    /** 列座標（右端。最終日を含む幅になるよう「翌日」の位置） */
    end: number;
    color: string;
    constructionTypeId: string | null;
    constructionTypeName: string;
}

export interface ScheduleChartLine {
    category: WorkCategoryKey;
    label: string;
    bars: ScheduleChartBar[];
}

export interface ScheduleChartRow {
    projectMasterId: string;
    label: string;
    startDate: string | null;
    endDate: string | null;
    /** 予定が入っている日数（同じ日の複数配置は1日） */
    workDays: number;
    /** 必ず組立・その他・解体の3本（バーが無い行も残す） */
    lines: ScheduleChartLine[];
}

export interface ScheduleChart {
    scale: ScheduleChartScale;
    months: ScheduleChartMonth[];
    /** 目盛の総数 */
    columnCount: number;
    rows: ScheduleChartRow[];
    /** 表の左端の日付（月初に丸めたもの） */
    gridStart: string | null;
    /** 実データの最初／最後の配置日 */
    rangeStart: string | null;
    rangeEnd: string | null;
    /** 「工期」欄に出す文字列（例: 2026/9/1 〜 2026/10/24）。対象が無ければ空文字 */
    termLabel: string;
    /** 実際に使われた工事種別（凡例用・出現順） */
    usedTypes: { id: string | null; name: string; color: string }[];
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

interface Ymd {
    year: number;
    month: number;
    day: number;
}

function parseYmd(value: string): Ymd | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** month は1始まり */
export function lastDayOfMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM-DD' に日数を足す（UTC計算なのでタイムゾーンの影響を受けない） */
export function addDays(value: string, days: number): string {
    const p = parseYmd(value);
    if (!p) return value;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** from から to までの日数（to - from） */
export function daysBetween(from: string, to: string): number {
    const a = parseYmd(from);
    const b = parseYmd(to);
    if (!a || !b) return 0;
    const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
    return Math.round(ms / 86400000);
}

function monthKey(year: number, month: number): string {
    return `${year}-${pad2(month)}`;
}

function formatJpDate(value: string): string {
    const p = parseYmd(value);
    if (!p) return value;
    return `${p.year}/${p.month}/${p.day}`;
}

/** 表示範囲の月リスト（開始月〜終了月・いずれも月初〜月末まで使う） */
function buildMonths(start: Ymd, end: Ymd, scale: ScheduleChartScale): ScheduleChartMonth[] {
    const months: ScheduleChartMonth[] = [];
    let year = start.year;
    let month = start.month;
    let prevYear: number | null = null;
    // 3年ぶんを上限に暴走を止める（実データは前後6ヶ月ぶんしか来ない）
    for (let i = 0; i < 36; i += 1) {
        const last = lastDayOfMonth(year, month);
        months.push({
            key: monthKey(year, month),
            // 年が変わる区切りだけ年を添える（横に長い表で何年の1月か分からなくなるため）
            label: prevYear !== null && prevYear === year ? `${month}月` : `${year}年${month}月`,
            cellCount: scale === 'day' ? last : CELLS_PER_MONTH,
            cellLabels:
                scale === 'day'
                    ? Array.from({ length: last }, (_, d) => String(d + 1))
                    : ['5', '10', '15', '20', '25', String(last)],
        });
        prevYear = year;
        if (year === end.year && month === end.month) break;
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    return months;
}

interface PositionContext {
    scale: ScheduleChartScale;
    gridStart: string;
    monthIndex: Map<string, number>;
    columnCount: number;
}

/** 日付の列座標。範囲外は端にクランプする */
function columnPosition(date: string, ctx: PositionContext): number {
    const p = parseYmd(date);
    if (!p) return 0;

    if (ctx.scale === 'day') {
        const offset = daysBetween(ctx.gridStart, date);
        return Math.min(ctx.columnCount, Math.max(0, offset));
    }

    const index = ctx.monthIndex.get(monthKey(p.year, p.month));
    if (index === undefined) {
        const firstKey = [...ctx.monthIndex.keys()][0] ?? '';
        return monthKey(p.year, p.month) < firstKey ? 0 : ctx.columnCount;
    }
    const last = lastDayOfMonth(p.year, p.month);
    const cell = Math.min(CELLS_PER_MONTH - 1, Math.floor((p.day - 1) / 5));
    const cellDays = cell < CELLS_PER_MONTH - 1 ? 5 : Math.max(1, last - 25);
    const within = (p.day - 1 - cell * 5) / cellDays;
    return index * CELLS_PER_MONTH + cell + within;
}

interface DayType {
    id: string | null;
    name: string;
    color: string;
}

/**
 * 連続した同じ工事種別をひとまとめにしてバーにする。
 * 日が飛んだところ・工事種別が変わったところで区切る（画面のカレンダーと同じ区切り方）。
 */
function buildBars(typeByDate: Map<string, DayType>, ctx: PositionContext): ScheduleChartBar[] {
    const bars: ScheduleChartBar[] = [];
    let runStart: string | null = null;
    let runEnd: string | null = null;
    let runType: DayType | null = null;

    const flush = () => {
        if (!runStart || !runEnd || !runType) return;
        bars.push({
            start: columnPosition(runStart, ctx),
            // 最終日を含む幅にするため翌日の位置まで伸ばす
            end: columnPosition(addDays(runEnd, 1), ctx),
            color: runType.color,
            constructionTypeId: runType.id,
            constructionTypeName: runType.name,
        });
    };

    for (const date of [...typeByDate.keys()].sort()) {
        const type = typeByDate.get(date)!;
        if (runEnd && addDays(runEnd, 1) === date && runType && runType.id === type.id) {
            runEnd = date;
            continue;
        }
        flush();
        runStart = date;
        runEnd = date;
        runType = type;
    }
    flush();

    return bars;
}

/**
 * 工程表のデータを組み立てる。
 * 横軸は「対象案件の最初の配置日の月初 〜 最後の配置日の月末」に自動で合わせる。
 */
export function buildScheduleChart(
    projects: ScheduleChartInputProject[],
    constructionTypes: ScheduleChartConstructionTypeInput[] = [],
): ScheduleChart {
    const empty: ScheduleChart = {
        scale: 'day',
        months: [],
        columnCount: 0,
        rows: [],
        gridStart: null,
        rangeStart: null,
        rangeEnd: null,
        termLabel: '',
        usedTypes: [],
    };

    const typeById = new Map(constructionTypes.map(ct => [ct.id, ct]));

    let min: string | null = null;
    let max: string | null = null;
    for (const project of projects) {
        for (const entry of project.workEntries) {
            if (!parseYmd(entry.date)) continue;
            if (min === null || entry.date < min) min = entry.date;
            if (max === null || entry.date > max) max = entry.date;
        }
    }
    if (!min || !max) return empty;

    const start = parseYmd(min);
    const end = parseYmd(max);
    if (!start || !end) return empty;

    const gridStart = `${start.year}-${pad2(start.month)}-01`;
    const gridEnd = `${end.year}-${pad2(end.month)}-${pad2(lastDayOfMonth(end.year, end.month))}`;
    const totalDays = daysBetween(gridStart, gridEnd) + 1;
    const scale: ScheduleChartScale = totalDays <= MAX_DAY_SCALE_DAYS ? 'day' : 'fiveDay';

    const months = buildMonths(start, end, scale);
    const columnCount = months.reduce((sum, m) => sum + m.cellCount, 0);
    const ctx: PositionContext = {
        scale,
        gridStart,
        monthIndex: new Map(months.map((m, i) => [m.key, i])),
        columnCount,
    };

    const usedTypes = new Map<string, { id: string | null; name: string; color: string }>();

    const rows: ScheduleChartRow[] = projects.map(project => {
        // 工程行ごとに「日 → その日の工事種別」を作る。
        // 同じ日・同じ行に複数の配置があるときは最初の1つを代表にする。
        const byCategory = new Map<WorkCategoryKey, Map<string, DayType>>();
        for (const category of WORK_CATEGORIES) byCategory.set(category.key, new Map());

        const sorted = [...project.workEntries]
            .filter(e => parseYmd(e.date))
            .sort((a, b) => a.date.localeCompare(b.date));

        for (const entry of sorted) {
            const master = entry.constructionTypeId ? typeById.get(entry.constructionTypeId) : undefined;
            const categoryKey = classifyConstructionType(master?.name);
            const fallback = WORK_CATEGORIES.find(c => c.key === categoryKey)!;
            const type: DayType = {
                id: master?.id ?? null,
                name: master?.name ?? fallback.label,
                color: master?.color || fallback.defaultColor,
            };
            const dateMap = byCategory.get(categoryKey)!;
            if (!dateMap.has(entry.date)) {
                dateMap.set(entry.date, type);
                usedTypes.set(type.id ?? `_${type.name}`, type);
            }
        }

        const dates = sorted.map(e => e.date);
        return {
            projectMasterId: project.projectMasterId,
            label: project.label,
            startDate: dates[0] ?? null,
            endDate: dates[dates.length - 1] ?? null,
            workDays: new Set(dates).size,
            lines: WORK_CATEGORIES.map(category => ({
                category: category.key,
                label: category.label,
                bars: buildBars(byCategory.get(category.key)!, ctx),
            })),
        };
    });

    return {
        scale,
        months,
        columnCount,
        rows,
        gridStart,
        rangeStart: min,
        rangeEnd: max,
        termLabel: `${formatJpDate(min)} 〜 ${formatJpDate(max)}`,
        usedTypes: [...usedTypes.values()],
    };
}
