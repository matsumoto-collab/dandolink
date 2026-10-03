/**
 * 支払明細書（常用で来ている一人親方向け）の計算。
 *
 * 日数の数え方・明細行の初期値・合計と内消費税・日付の既定値を作る純粋関数だけを置く。
 * **Prisma にも react-pdf にも DOM にも依存しない**ので、API ルート・画面・PDF・テストから同じ式を使える。
 *
 * 金額の考え方（2026-10 時点の運用を写したもの）:
 *   - 単価は税込（内税）。合計 = 行の金額の合計。
 *   - 内消費税等 = 合計 × 10 / 110 の円未満切り捨て。
 *   - 行の金額 = 数量 × 単価 を円単位に四捨五入（数量は 0.5 などの小数を許す。小数第2位まで）。
 */

/** 消費税率（10% 固定。軽減税率の対象になる取引は無い） */
export const JOYO_TAX_PERCENT = 10;

/**
 * 入力の上限。API の検証（zod）・画面の入力欄・PDF の3か所で同じ値を使う。
 * 文字数と行数は「PDF の1ページ目に必ず収まる」大きさにしてある（PDF 側はこの数で行数を固定している）。
 * 変えるときは components/pdf/JoyoStatementPDF.tsx を描き直して、はみ出しと改ページを確かめること。
 */
export const JOYO_LIMITS = {
    /** 明細の行数（PDF の表はこの行数で固定） */
    maxItems: 16,
    /** 品名 */
    nameLength: 24,
    /** 単位 */
    unitLength: 4,
    /** 備考（PDF では2行まで） */
    noteLength: 30,
    /** 件名 */
    subjectLength: 36,
    /** 書類の名前（見出し） */
    titleLength: 20,
    /** 下の注意書き（PDF では4行まで） */
    footerLength: 200,
    footerLines: 4,
    /** 宛名 */
    recipientNameLength: 24,
    /** 住所（PDF では3行まで） */
    addressLength: 60,
    /** 数量（小数第2位まで） */
    maxQuantity: 999,
    /** 単価の絶対値（円） */
    maxUnitPrice: 999_999,
    /** 合計の絶対値（円）。DB の列は INTEGER */
    maxTotal: 99_999_999,
} as const;

/** 明細行の種類。auto 系は出勤簿から作った行、manual は手で足した行 */
export type JoyoItemKind = 'full' | 'holiday_work' | 'night_shift' | 'manual';

export interface JoyoStatementItem {
    kind: JoyoItemKind;
    /** 品名 */
    name: string;
    /** 数量（0.5 刻みなどの小数可） */
    quantity: number;
    /** 単位（日・式 など） */
    unit: string;
    /** 単価（円・税込）。マイナス可（差し引く行） */
    unitPrice: number;
    /** 金額（円）= round(数量 × 単価) */
    amount: number;
    /** 備考 */
    note: string;
}

/** 出勤簿の1日ぶん（GET /api/attendance のレコードの部分集合）。**1人ぶんに絞ってから渡す**（ここでは userId を見ない） */
export interface JoyoAttendanceRecord {
    /** 'YYYY-MM-DD' で始まる文字列（ISO 形式でもよい） */
    date: string;
    status: string;
}

export interface JoyoDayCounts {
    /** 出勤 */
    present: number;
    /** 休日出勤 */
    holidayWork: number;
    /** 夜勤 */
    nightShift: number;
    /** 休日（「休日」の記録がある日だけ。記録の無い日曜は入れない） */
    holiday: number;
    /** 欠勤 */
    absent: number;
    /** 有給 */
    paidLeave: number;
    /** 代休 */
    compensatoryHoliday: number;
    /** 記録の無い月〜土（'YYYY-MM-DD'）。today 当日と、それより後の日は入れない */
    missingDays: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** その月の日数 */
export function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 対象月の出勤簿を区分ごとに数える。
 * @param today 'YYYY-MM-DD'（JST）。当日と、それより後の日は「記録が無い」と数えない（当日はまだ入力前のことがある）。省略＝月末まで全部見る
 */
export function countJoyoDays(
    year: number,
    month: number,
    records: JoyoAttendanceRecord[],
    today?: string,
): JoyoDayCounts {
    const prefix = `${year}-${pad2(month)}-`;
    const byDate = new Map<string, string>();
    for (const r of records) {
        const d = r.date.slice(0, 10);
        if (d.startsWith(prefix)) byDate.set(d, r.status);
    }

    const counts: JoyoDayCounts = {
        present: 0,
        holidayWork: 0,
        nightShift: 0,
        holiday: 0,
        absent: 0,
        paidLeave: 0,
        compensatoryHoliday: 0,
        missingDays: [],
    };

    const last = daysInMonth(year, month);
    for (let day = 1; day <= last; day++) {
        const d = `${prefix}${pad2(day)}`;
        const status = byDate.get(d);
        if (status === undefined) {
            // 記録の無い日曜は休日扱い（出勤簿の画面・PDF と同じ）。月〜土で記録が無い日だけ知らせる
            const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            if (dow !== 0 && (!today || d < today)) counts.missingDays.push(d);
            continue;
        }
        if (status === 'present') counts.present += 1;
        else if (status === 'holiday_work') counts.holidayWork += 1;
        else if (status === 'night_shift') counts.nightShift += 1;
        else if (status === 'holiday') counts.holiday += 1;
        else if (status === 'absent') counts.absent += 1;
        else if (status === 'paid_leave') counts.paidLeave += 1;
        else if (status === 'compensatory_holiday') counts.compensatoryHoliday += 1;
    }
    return counts;
}

/**
 * 行の金額 = 数量 × 単価（円単位に四捨五入）。
 * 数量を 1/100 単位の整数に直してから掛ける（0.47 × 17,350 = 8154.5 のような端数で、浮動小数の誤差が出ないように）。
 * 四捨五入は絶対値で行う（プラスの行とマイナスの行が同じ大きさになる）。-0 は 0 に直す。
 */
export function itemAmount(quantity: number, unitPrice: number): number {
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return 0;
    const hundredths = Math.round(quantity * 100) * Math.round(unitPrice);
    return Math.sign(hundredths) * Math.round(Math.abs(hundredths) / 100) || 0;
}

/** 数量を小数第2位に丸める（画面の入力確定時と、サーバーの保存前の両方で通す） */
export function roundQuantity(quantity: number): number {
    if (!Number.isFinite(quantity)) return 0;
    return Math.round(quantity * 100) / 100;
}

/** 出勤簿から作る行の種類（この3つだけ「出勤簿の日数に合わせる」の対象） */
const AUTO_KINDS: { kind: Exclude<JoyoItemKind, 'manual'>; name: string; count: (c: JoyoDayCounts) => number }[] = [
    { kind: 'full', name: '常用（全日）', count: (c) => c.present },
    { kind: 'holiday_work', name: '常用（休日出勤）', count: (c) => c.holidayWork },
    { kind: 'night_shift', name: '常用（夜勤）', count: (c) => c.nightShift },
];

/**
 * 明細行を今の出勤簿の日数に合わせる（「出勤簿の日数に合わせる」ボタン用）。
 * - 出勤簿から作った行（全日・休日出勤・夜勤）は数量だけ入れ直す。単価・品名・備考は手直しを残す
 * - 日数が 0 になった休日出勤・夜勤の行は消す（全日の行は 0 日でも残す）
 * - 日数が出てきたのに行が無ければ足す（単価は unitPrice）
 * - 手で足した行（manual）は触らない。行の並びは「出勤簿の行（全日 → 休日出勤 → 夜勤）→ 手で足した行」
 * - 出勤簿の行は種類ごとに1行までが前提（保存時に hasDuplicateAutoKinds で断る）。2行あったら先の1行だけ残る
 */
export function syncItemsWithCounts(
    items: JoyoStatementItem[],
    counts: JoyoDayCounts,
    unitPrice: number,
): JoyoStatementItem[] {
    const auto: JoyoStatementItem[] = [];
    for (const def of AUTO_KINDS) {
        const quantity = def.count(counts);
        const existing = items.find((it) => it.kind === def.kind);
        if (existing) {
            if (quantity === 0 && def.kind !== 'full') continue;
            auto.push({ ...existing, quantity, amount: itemAmount(quantity, existing.unitPrice) });
        } else if (quantity > 0 || def.kind === 'full') {
            auto.push({
                kind: def.kind,
                name: def.name,
                quantity,
                unit: '日',
                unitPrice,
                amount: itemAmount(quantity, unitPrice),
                note: '',
            });
        }
    }
    return [...auto, ...items.filter((it) => it.kind === 'manual')];
}

/** 出勤簿から作る行（全日・休日出勤・夜勤）が、同じ種類で2行以上あるか */
export function hasDuplicateAutoKinds(items: Pick<JoyoStatementItem, 'kind'>[]): boolean {
    const seen = new Set<JoyoItemKind>();
    for (const it of items) {
        if (it.kind === 'manual') continue;
        if (seen.has(it.kind)) return true;
        seen.add(it.kind);
    }
    return false;
}

/** 出勤簿の日数から作る明細行の初期値。0 日の区分は行を作らない（出勤だけは 0 日でも 1 行出す） */
export function buildDefaultItems(counts: JoyoDayCounts, unitPrice: number): JoyoStatementItem[] {
    return syncItemsWithCounts([], counts, unitPrice);
}

/** 金額に関わる日数（出勤・休日出勤・夜勤）が変わったか。保存時の日数と今の出勤簿を見比べる */
export function paidDaysChanged(
    before: Pick<JoyoDayCounts, 'present' | 'holidayWork' | 'nightShift'> | null | undefined,
    after: Pick<JoyoDayCounts, 'present' | 'holidayWork' | 'nightShift'>,
): boolean {
    if (!before) return false;
    return (
        before.present !== after.present ||
        before.holidayWork !== after.holidayWork ||
        before.nightShift !== after.nightShift
    );
}

/** 数量を小数第2位に丸め、行の金額を 数量×単価 で入れ直す（保存前にサーバーで必ず通す。画面から来た金額は使わない） */
export function recalcItems(items: (Omit<JoyoStatementItem, 'amount'> & { amount?: number })[]): JoyoStatementItem[] {
    return items.map((it) => {
        const quantity = roundQuantity(it.quantity);
        return { ...it, quantity, amount: itemAmount(quantity, it.unitPrice) };
    });
}

/** 合計（税込）と内消費税等。内消費税 = 合計 × 10 / 110 の円未満切り捨て */
export function computeJoyoTotals(items: Pick<JoyoStatementItem, 'amount'>[]): { total: number; tax: number } {
    const total = items.reduce((s, it) => s + (Number.isFinite(it.amount) ? it.amount : 0), 0);
    const tax = Math.trunc((total * JOYO_TAX_PERCENT) / (100 + JOYO_TAX_PERCENT));
    return { total, tax };
}

/** 発行日の既定＝対象月の末日 */
export function defaultIssueDate(year: number, month: number): string {
    return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

/** 支払日の既定＝対象月の翌月10日（土日祝でもずらさない＝支払予定の今の運用と同じ） */
export function defaultPaymentDate(year: number, month: number): string {
    const y = month === 12 ? year + 1 : year;
    const m = month === 12 ? 1 : month + 1;
    return `${y}-${pad2(m)}-10`;
}

/** 'YYYY-MM-DD' → '令和8年8月31日'（2019年5月1日より前は西暦のまま返す） */
export function toReiwaYmd(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!m) return ymd;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 2019 || (y === 2019 && mo < 5)) return `${y}年${mo}月${d}日`;
    const reiwa = y - 2018;
    return `令和${reiwa === 1 ? '元' : reiwa}年${mo}月${d}日`;
}

/** 件名の既定＝「令和8年8月分 常用代金」 */
export function defaultSubject(year: number, month: number): string {
    const head = toReiwaYmd(`${year}-${pad2(month)}-01`).replace(/\d+日$/, '');
    return `${head}分 常用代金`;
}

/** 対象期間の表記＝「令和8年8月1日 〜 令和8年8月31日」 */
export function periodLabel(year: number, month: number): string {
    return `${toReiwaYmd(`${year}-${pad2(month)}-01`)} 〜 ${toReiwaYmd(defaultIssueDate(year, month))}`;
}

/** 書類番号＝対象年月 + 対象者の番号（例: 202608-01）。対象者と対象月で決まるので発行し直しても変わらない */
export function buildStatementNo(year: number, month: number, contractorCode: number): string {
    return `${year}${pad2(month)}-${pad2(contractorCode)}`;
}

/** 数量の表示（23 / 24.5）。小数は第2位まで、末尾の 0 は落とす */
export function formatQuantity(quantity: number): string {
    if (!Number.isFinite(quantity)) return '';
    return String(Math.round(quantity * 100) / 100);
}
