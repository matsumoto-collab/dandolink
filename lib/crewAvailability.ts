import { prisma } from '@/lib/prisma';
import { toJstDateOnly, jstDayStartUtc } from '@/lib/dateUtils';
import { parseJsonField } from '@/lib/json-utils';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { FLOATING_LANE_ID } from '@/lib/floatingLaneOrder';

/**
 * 班別空き状況の計算（AIなしの純粋なDB集計）。
 *
 * 設計書『班別空き状況_AI問い合わせ_実装設計書.md』＋『仮予定・浮き管理_AI照会_実装設計書.md』§4-5。
 * 「数字はDB・言葉はAI」の分担で、空き時間・調整候補・浮きの数字は全てここで計算し、
 * AI（lib/crewAvailabilityAI.ts 相当のルート）は日付解釈と文章化のみを行う。
 *
 * - 空き時間 = STANDARD_HOURS(8) − Σ(その日その班の estimatedHours)。マイナスは0。
 * - マッチングの通貨は人数（memberCount）。時間は参考表示（§10-A #10）。
 * - negotiableMembers = 仮予定（dateStatus='tentative'）の memberCount 合計 =「仮が動けば浮かせられる人数」。
 * - floating = 班未定（assignedEmployeeId='unassigned'）の配置 = 行き場のない需要。
 * - owners = 案件担当者（extractAssigneeIds(ProjectMaster.createdBy)・[0]=主担当）。managerIds は死蔵で読まない。
 */

export const STANDARD_HOURS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CrewJob {
    site: string;
    hours: number;
    memberCount: number;
    dateStatus: 'confirmed' | 'tentative';
    /** 仮予定の先方確認予定日（YYYY-MM-DD・JST） */
    confirmDueDate: string | null;
    /** 案件担当者の表示名（[0]=主担当） */
    owners: string[];
}

export interface CrewAvailabilityRow {
    team: string;
    status: 'ok' | 'off';
    jobs: CrewJob[];
    usedHours: number;
    freeHours: number;
    usedMembers: number;
    /** 仮予定が動けば浮かせられる人数（仮予定 memberCount の合計） */
    negotiableMembers: number;
}

export interface FloatingItem {
    site: string;
    /** YYYY-MM-DD（JST）。dateStatus='tentative' の浮きはこの日付自体が経験則の仮置き */
    date: string;
    memberCount: number;
    dateStatus: 'confirmed' | 'tentative';
    note: string | null;
    owners: string[];
}

/**
 * 日ごとの人数サマリ。週間カレンダーの「残り人数」行と同じ計算規約:
 * remainingMembers = 総メンバー数(MemberCountHistory+手動調整) − 使用人数(班ごと最大＋浮き加算) − 休暇人数
 * 「余っている人数」「残り人数」「空いている人数」の質問はこれで答える。
 */
export interface DailyCrewSummary {
    /** YYYY-MM-DD（JST） */
    date: string;
    /** その日の総メンバー数（手動調整込み） */
    totalMembers: number;
    /** 配置で使っている人数（班ごとに最大値＋浮きは単純加算。同じ班の掛け持ちは二重に数えない） */
    usedMembers: number;
    /** 休暇の人数 */
    vacationMembers: number;
    /** 余っている人数 = totalMembers − usedMembers − vacationMembers（マイナス=入れすぎ） */
    remainingMembers: number;
    /** 仮予定が動けば追加で浮かせられる人数 */
    negotiableMembers: number;
    /** 仮予定（dateStatus='tentative'）の件数。人数0の仮予定があるため negotiableMembers とは別物 */
    tentativeJobCount: number;
    /** 浮き（班未定）の件数 */
    floatingCount: number;
    /** 浮きの必要人数合計 */
    floatingMembers: number;
}

export interface CrewAvailabilityResult {
    /** YYYY-MM-DD（JST） */
    date: string;
    /** 会社全体の人数サマリ（残り人数はここを見る） */
    summary: DailyCrewSummary;
    teams: CrewAvailabilityRow[];
    /** その日の浮き（班未定の需要） */
    floating: FloatingItem[];
}

/** JST日キー（YYYY-MM-DD）。toJstDateOnly 済みの Date は getUTC* が JST の年月日になる */
export function jstDateKey(d: Date): string {
    const j = toJstDateOnly(d);
    const y = j.getUTCFullYear();
    const m = String(j.getUTCMonth() + 1).padStart(2, '0');
    const day = String(j.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export type PmLite = {
    name: string | null;
    title: string;
    honorific: string | null;
    createdBy: string | null;
} | null;

export function siteName(pm: PmLite): string {
    if (!pm) return '不明な案件';
    return pm.name ? `${pm.name}${pm.honorific || ''}` : pm.title;
}

/** 表示対象の班（職長）一覧。SystemSettings.displayedForemanIds → 空なら foreman ロールで代替 */
async function loadForemen(): Promise<Array<{ id: string; name: string }>> {
    const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { displayedForemanIds: true },
    });
    // 'unassigned' は浮きレーンの表示位置を表す予約IDで班ではない（lib/floatingLaneOrder.ts）
    const ids = parseJsonField<string[]>(settings?.displayedForemanIds ?? null, [])
        .filter((id) => id !== FLOATING_LANE_ID);

    if (ids.length > 0) {
        const users = await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayName: true },
        });
        const byId = new Map(users.map((u) => [u.id, u.displayName]));
        // displayedForemanIds の並び順を維持（配置表と同じ見え方にする）
        return ids
            .filter((id) => byId.has(id))
            .map((id) => ({ id, name: byId.get(id)! }));
    }

    const foremen = await prisma.user.findMany({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'FOREMAN1', 'FOREMAN2'] } },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
    });
    return foremen.map((u) => ({ id: u.id, name: u.displayName }));
}

/** createdBy 群から担当者IDを収集し、表示名マップを引く */
export async function resolveOwnerNames(createdByList: Array<string | null>): Promise<Map<string, string>> {
    const idSet = new Set<string>();
    for (const cb of createdByList) {
        for (const id of extractAssigneeIds(cb ?? undefined)) idSet.add(id);
    }
    if (idSet.size === 0) return new Map();
    const users = await prisma.user.findMany({
        where: { id: { in: Array.from(idSet) } },
        select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
}

export function ownersOf(pm: PmLite, nameById: Map<string, string>): string[] {
    const ids = extractAssigneeIds(pm?.createdBy ?? undefined);
    return ids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
}

/**
 * 日付キーごとの総メンバー数の解決関数を作る。
 * クライアント（masterStore.getTotalMembersForDate）と同じ規約:
 * MemberCountHistory の startDate ≦ 対象日 の最新 count。履歴が対象日より全て後なら最古の count。
 * 履歴が1件も無ければ SystemSettings.totalMembers。
 */
async function loadTotalMembersResolver(): Promise<(dateKey: string) => number> {
    const [history, settings] = await Promise.all([
        prisma.memberCountHistory.findMany({
            orderBy: { startDate: 'asc' },
            select: { startDate: true, count: true },
        }),
        prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { totalMembers: true } }),
    ]);
    const fallback = settings?.totalMembers ?? 20;
    const entries = history.map((h) => ({ dateKey: jstDateKeyFromDbDate(h.startDate), count: h.count }));
    return (dateKey: string): number => {
        if (entries.length === 0) return fallback;
        let result = entries[0].count;
        for (const e of entries) {
            if (e.dateKey <= dateKey) result = e.count;
            else break;
        }
        return result;
    };
}

/** MemberCountHistory.startDate は @db.Date（UTC 0時）。UTC の年月日をそのままキーにする */
function jstDateKeyFromDbDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

interface SummaryInputRow {
    assignedEmployeeId: string;
    memberCount: number | null;
    dateStatus: string | null;
}

/** カレンダーの「残り人数」行と同じ規約で1日分のサマリを計算する（純粋関数） */
function computeDailySummary(params: {
    dateKey: string;
    rows: SummaryInputRow[];
    vacationCount: number;
    adjustment: number;
    baseTotal: number;
}): DailyCrewSummary {
    const { dateKey, rows, vacationCount, adjustment, baseTotal } = params;
    const byForeman = new Map<string, number>();
    let floatingMembers = 0;
    let floatingCount = 0;
    let negotiableMembers = 0;
    let tentativeJobCount = 0;
    for (const r of rows) {
        const count = r.memberCount ?? 0;
        if (r.dateStatus === 'tentative') {
            tentativeJobCount += 1;
        }
        if (r.dateStatus === 'tentative' && r.assignedEmployeeId !== 'unassigned') {
            negotiableMembers += count;
        }
        if (!r.assignedEmployeeId || r.assignedEmployeeId === 'unassigned') {
            floatingCount += 1;
            floatingMembers += count;
            continue;
        }
        // 同じ班の同日掛け持ちは最大値（同じメンバーが回るため二重に数えない）
        byForeman.set(r.assignedEmployeeId, Math.max(byForeman.get(r.assignedEmployeeId) ?? 0, count));
    }
    let usedMembers = floatingMembers;
    byForeman.forEach((max) => {
        usedMembers += max;
    });
    const totalMembers = baseTotal + adjustment;
    return {
        date: dateKey,
        totalMembers,
        usedMembers,
        vacationMembers: vacationCount,
        remainingMembers: totalMembers - usedMembers - vacationCount,
        negotiableMembers,
        tentativeJobCount,
        floatingCount,
        floatingMembers,
    };
}

/** 指定日の班別空き状況＋浮き一覧 */
export async function getCrewAvailability(dateStr: string): Promise<CrewAvailabilityResult> {
    const dayStart = jstDayStartUtc(dateStr);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
    const dateKey = jstDateKey(dayStart);

    const [assignments, foremen, vacation, adjustment, resolveTotalMembers] = await Promise.all([
        prisma.projectAssignment.findMany({
            where: { date: { gte: dayStart, lt: dayEnd } },
            select: {
                assignedEmployeeId: true,
                estimatedHours: true,
                memberCount: true,
                dateStatus: true,
                confirmDueDate: true,
                remarks: true,
                projectMaster: {
                    select: { name: true, title: true, honorific: true, createdBy: true },
                },
            },
        }),
        loadForemen(),
        prisma.vacationRecord.findUnique({ where: { dateKey } }),
        prisma.memberAdjustment.findUnique({ where: { dateKey } }),
        loadTotalMembersResolver(),
    ]);

    const offIds = vacation ? parseJsonField<string[]>(vacation.employeeIds, []) : [];
    const ownerNames = await resolveOwnerNames(assignments.map((a) => a.projectMaster?.createdBy ?? null));

    const teams: CrewAvailabilityRow[] = foremen.map((f) => {
        if (offIds.includes(f.id)) {
            return { team: f.name, status: 'off', jobs: [], usedHours: 0, freeHours: 0, usedMembers: 0, negotiableMembers: 0 };
        }
        const mine = assignments.filter((a) => a.assignedEmployeeId === f.id);
        const jobs: CrewJob[] = mine.map((a) => ({
            site: siteName(a.projectMaster),
            hours: a.estimatedHours ?? STANDARD_HOURS,
            memberCount: a.memberCount ?? 0,
            dateStatus: a.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
            confirmDueDate: a.confirmDueDate ? jstDateKey(a.confirmDueDate) : null,
            owners: ownersOf(a.projectMaster, ownerNames),
        }));
        const usedHours = jobs.reduce((s, j) => s + j.hours, 0);
        // 同じ班の同日掛け持ちは最大値（同じメンバーが回る前提。カレンダーの残り人数と同じ規約）
        const usedMembers = jobs.reduce((mx, j) => Math.max(mx, j.memberCount), 0);
        const negotiableMembers = jobs
            .filter((j) => j.dateStatus === 'tentative')
            .reduce((s, j) => s + j.memberCount, 0);
        return {
            team: f.name,
            status: 'ok',
            jobs,
            usedHours,
            freeHours: Math.max(0, STANDARD_HOURS - usedHours),
            usedMembers,
            negotiableMembers,
        };
    });

    const floating: FloatingItem[] = assignments
        .filter((a) => a.assignedEmployeeId === 'unassigned')
        .map((a) => ({
            site: siteName(a.projectMaster),
            date: dateKey,
            memberCount: a.memberCount ?? 0,
            dateStatus: a.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
            note: a.remarks ?? null,
            owners: ownersOf(a.projectMaster, ownerNames),
        }));

    const summary = computeDailySummary({
        dateKey,
        rows: assignments,
        vacationCount: offIds.length,
        adjustment: adjustment?.adjustment ?? 0,
        baseTotal: resolveTotalMembers(dateKey),
    });

    return { date: dateKey, summary, teams, floating };
}

/** 期間サマリの最大日数（「直近の余っている人数」のような質問に1回のツール呼び出しで答えるため） */
const MAX_SUMMARY_RANGE_DAYS = 14;

/**
 * 期間内の日ごとの人数サマリ（既定=今日から7日間・最大14日）。
 * 「直近で余っている人数は？」のような質問はこれで答える。
 */
export async function getCrewAvailabilitySummaryRange(
    startDateStr?: string,
    endDateStr?: string
): Promise<DailyCrewSummary[]> {
    const start = jstDayStartUtc(startDateStr ?? new Date());
    const requestedEnd = endDateStr
        ? new Date(jstDayStartUtc(endDateStr).getTime() + MS_PER_DAY)
        : new Date(start.getTime() + 7 * MS_PER_DAY);
    const maxEnd = new Date(start.getTime() + MAX_SUMMARY_RANGE_DAYS * MS_PER_DAY);
    const end = requestedEnd.getTime() > maxEnd.getTime() ? maxEnd : requestedEnd;
    if (end.getTime() <= start.getTime()) return [];

    const dayCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
    const dateKeys = Array.from({ length: dayCount }, (_, i) =>
        jstDateKey(new Date(start.getTime() + i * MS_PER_DAY))
    );

    const [assignments, vacations, adjustments, resolveTotalMembers] = await Promise.all([
        prisma.projectAssignment.findMany({
            where: { date: { gte: start, lt: end } },
            select: { date: true, assignedEmployeeId: true, memberCount: true, dateStatus: true },
        }),
        prisma.vacationRecord.findMany({ where: { dateKey: { in: dateKeys } } }),
        prisma.memberAdjustment.findMany({ where: { dateKey: { in: dateKeys } } }),
        loadTotalMembersResolver(),
    ]);

    const rowsByDay = new Map<string, SummaryInputRow[]>();
    for (const a of assignments) {
        const key = jstDateKey(a.date);
        const arr = rowsByDay.get(key);
        if (arr) arr.push(a);
        else rowsByDay.set(key, [a]);
    }
    const vacationByDay = new Map(
        vacations.map((v) => [v.dateKey, parseJsonField<string[]>(v.employeeIds, []).length])
    );
    const adjustmentByDay = new Map(adjustments.map((m) => [m.dateKey, m.adjustment]));

    return dateKeys.map((dateKey) =>
        computeDailySummary({
            dateKey,
            rows: rowsByDay.get(dateKey) ?? [],
            vacationCount: vacationByDay.get(dateKey) ?? 0,
            adjustment: adjustmentByDay.get(dateKey) ?? 0,
            baseTotal: resolveTotalMembers(dateKey),
        })
    );
}

/** 期間内の浮き一覧（既定=今日から30日先まで） */
export async function getFloating(startDateStr?: string, endDateStr?: string): Promise<FloatingItem[]> {
    const start = jstDayStartUtc(startDateStr ?? new Date());
    const end = endDateStr
        ? new Date(jstDayStartUtc(endDateStr).getTime() + MS_PER_DAY)
        : new Date(start.getTime() + 30 * MS_PER_DAY);

    const rows = await prisma.projectAssignment.findMany({
        where: {
            assignedEmployeeId: 'unassigned',
            date: { gte: start, lt: end },
        },
        orderBy: { date: 'asc' },
        select: {
            date: true,
            memberCount: true,
            dateStatus: true,
            remarks: true,
            projectMaster: {
                select: { name: true, title: true, honorific: true, createdBy: true },
            },
        },
    });

    const ownerNames = await resolveOwnerNames(rows.map((r) => r.projectMaster?.createdBy ?? null));

    return rows.map((a) => ({
        site: siteName(a.projectMaster),
        date: jstDateKey(a.date),
        memberCount: a.memberCount ?? 0,
        dateStatus: a.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
        note: a.remarks ?? null,
        owners: ownersOf(a.projectMaster, ownerNames),
    }));
}
