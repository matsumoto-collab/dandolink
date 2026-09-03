import { dueDateFromClosing, type DueDatePreset } from '@/lib/closingDay';
import { ymDiff, ymOf } from '@/lib/orderBacklog/render';
import {
    DEFAULT_ASSEMBLY_SHARE,
    SCHEDULE_COLUMN_COUNT,
    type ScheduleMap,
} from '@/lib/orderBacklog/types';

/**
 * 提案の入力になる配置（スケジュール1コマ）。
 * constructionType は **名前**（'組立' / '解体'）。ID で来る場合は呼び出し側で
 * ConstructionType マスタの名前に解決してから渡すこと。
 */
export interface ProposeAssignment {
    /** 作業日 'YYYY-MM-DD' */
    date: string;
    constructionType: string | null;
}

/** 種別は '組立(解体)' のような複合名が本番にあるので含むかどうかで見る。 */
const isAssembly = (a: ProposeAssignment) => (a.constructionType ?? '').includes('組立');
const isDemolition = (a: ProposeAssignment) => (a.constructionType ?? '').includes('解体');

/** 作業日の昇順（同じ日は元の順を保つ）。 */
function sortByDate(assignments: readonly ProposeAssignment[]): ProposeAssignment[] {
    return [...assignments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function findLast(
    assignments: readonly ProposeAssignment[],
    predicate: (a: ProposeAssignment) => boolean,
): ProposeAssignment | null {
    for (let i = assignments.length - 1; i >= 0; i--) {
        if (predicate(assignments[i])) return assignments[i];
    }
    return null;
}

/**
 * 出来高％の提案（0 / 50 / 100 の3分岐）。
 * - 基準日までに1日も入っていない → 0（まだ着工していない）
 * - 基準日までに解体が済んでいる、または先の予定が無い → 100
 * - それ以外（着工済みで先の予定も残っている） → 50
 */
export function proposeProgressRate(
    assignments: readonly ProposeAssignment[],
    asOf: string,
): number {
    const past = assignments.filter((a) => a.date <= asOf);
    if (past.length === 0) return 0;
    const hasFuture = assignments.some((a) => a.date > asOf);
    if (past.some(isDemolition) || !hasFuture) return 100;
    return 50;
}

/**
 * 着工・完成予定の年月の提案。
 * 配置が1件しか無ければ完成予定は空欄にする（同じ月を2度書かないため）。
 */
export function proposeStartEndYm(
    assignments: readonly ProposeAssignment[],
): { startYm: string | null; endYm: string | null } {
    const sorted = sortByDate(assignments);
    if (sorted.length === 0) return { startYm: null, endYm: null };
    return {
        startYm: ymOf(sorted[0].date),
        endYm: sorted.length > 1 ? ymOf(sorted[sorted.length - 1].date) : null,
    };
}

/**
 * 作業日 → 入金月 'YYYY-MM'。
 * 作業日が締め日以前ならその月、過ぎていれば翌月が締め月（closingDay 0=末締め＝当月）。
 * そこから入金サイト（未設定は翌月末）で支払期日を出し、その年月を返す。
 */
export function dueYmFor(
    workYmd: string,
    closingDay?: number | null,
    preset?: DueDatePreset | null,
): string {
    const [year, month, day] = workYmd.split('-').map(Number);
    const cd = !closingDay || closingDay <= 0 ? 0 : closingDay;
    const closingMonth0 = month - 1 + (cd !== 0 && day > cd ? 1 : 0);
    return ymOf(dueDateFromClosing(year, closingMonth0, preset ?? 'nextMonthEnd'));
}

export interface ProposeScheduleParams {
    /** 契約額（円） */
    contractAmount: number;
    /** 既受領（円） */
    receivedAmount: number;
    assignments: readonly ProposeAssignment[];
    closingDay?: number | null;
    preset?: DueDatePreset | null;
    /** 基準日 'YYYY-MM-DD' */
    asOf: string;
    /** 組立月へ寄せる割合（％）。残りが解体月 */
    assemblyShare?: number;
}

/**
 * 入金予定の提案。実データでは組立月60%・解体月40%で振っている案件が多い。
 *
 * 1. 組立月＝最初の「組立」（無ければ最初の配置）／解体月＝最後の「解体」（無ければ最後の配置）
 * 2. 解体月があれば 60% / 40%、無ければ 100% を組立月の入金月へ
 * 3. 既受領は早い口から差し引く（既受領が全額以上なら空）
 * 4. 基準月より前は第1列へ寄せ、基準月+8 以降は 'later'
 *
 * 端数は最後の口に寄せるので、戻り値の合計は必ず「契約額 − 既受領」になる。
 */
export function proposeSchedule(params: ProposeScheduleParams): ScheduleMap {
    const {
        contractAmount,
        receivedAmount,
        assignments,
        closingDay,
        preset,
        asOf,
        assemblyShare = DEFAULT_ASSEMBLY_SHARE,
    } = params;

    const sorted = sortByDate(assignments);
    if (sorted.length === 0) return {};

    const total = Math.max(0, Math.round(contractAmount));
    if (total === 0) return {};

    const assembly = sorted.find(isAssembly) ?? sorted[0];
    const demolition = findLast(sorted, isDemolition) ?? sorted[sorted.length - 1];
    const assemblyYm = dueYmFor(assembly.date, closingDay, preset);
    const demolitionYm = dueYmFor(demolition.date, closingDay, preset);
    // 解体が組立と同じ日、または入金月が同じなら分割しない（同じ月に60%+40%を入れるのと同じ）
    const split = demolition !== assembly && demolitionYm !== assemblyYm;

    const entries: { ym: string; amount: number }[] = [];
    if (split) {
        const share = Math.min(100, Math.max(0, assemblyShare));
        const first = Math.round((total * share) / 100);
        entries.push({ ym: assemblyYm, amount: first });
        // 端数を最後の口に寄せて合計を保つ
        entries.push({ ym: demolitionYm, amount: total - first });
    } else {
        entries.push({ ym: assemblyYm, amount: total });
    }

    // 既受領は早い口から消し込む
    entries.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    let unapplied = Math.max(0, Math.round(receivedAmount));
    for (const entry of entries) {
        const cut = Math.min(entry.amount, unapplied);
        entry.amount -= cut;
        unapplied -= cut;
    }

    const baseYm = ymOf(asOf);
    const lastIndex = SCHEDULE_COLUMN_COUNT - 1;
    const schedule: ScheduleMap = {};
    for (const entry of entries) {
        if (entry.amount <= 0) continue;
        const diff = ymDiff(entry.ym, baseYm);
        const key = diff <= 0 ? baseYm : diff >= lastIndex ? 'later' : entry.ym;
        schedule[key] = (schedule[key] ?? 0) + entry.amount;
    }
    return schedule;
}
