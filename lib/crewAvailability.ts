import { prisma } from '@/lib/prisma';
import { toJstDateOnly } from '@/lib/dateUtils';
import { parseJsonField } from '@/lib/json-utils';
import { extractAssigneeIds } from '@/lib/projectAssignees';

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

export interface CrewAvailabilityResult {
    /** YYYY-MM-DD（JST） */
    date: string;
    teams: CrewAvailabilityRow[];
    /** その日の浮き（班未定の需要） */
    floating: FloatingItem[];
}

/** JST日キー（YYYY-MM-DD）。toJstDateOnly 済みの Date は getUTC* が JST の年月日になる */
function jstDateKey(d: Date): string {
    const j = toJstDateOnly(d);
    const y = j.getUTCFullYear();
    const m = String(j.getUTCMonth() + 1).padStart(2, '0');
    const day = String(j.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

type PmLite = {
    name: string | null;
    title: string;
    honorific: string | null;
    createdBy: string | null;
} | null;

function siteName(pm: PmLite): string {
    if (!pm) return '不明な案件';
    return pm.name ? `${pm.name}${pm.honorific || ''}` : pm.title;
}

/** 表示対象の班（職長）一覧。SystemSettings.displayedForemanIds → 空なら foreman ロールで代替 */
async function loadForemen(): Promise<Array<{ id: string; name: string }>> {
    const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { displayedForemanIds: true },
    });
    const ids = parseJsonField<string[]>(settings?.displayedForemanIds ?? null, []);

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
async function resolveOwnerNames(createdByList: Array<string | null>): Promise<Map<string, string>> {
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

function ownersOf(pm: PmLite, nameById: Map<string, string>): string[] {
    const ids = extractAssigneeIds(pm?.createdBy ?? undefined);
    return ids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
}

/** 指定日の班別空き状況＋浮き一覧 */
export async function getCrewAvailability(dateStr: string): Promise<CrewAvailabilityResult> {
    const dayStart = toJstDateOnly(dateStr);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
    const dateKey = jstDateKey(dayStart);

    const [assignments, foremen, vacation] = await Promise.all([
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
        const usedMembers = jobs.reduce((s, j) => s + j.memberCount, 0);
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

    return { date: dateKey, teams, floating };
}

/** 期間内の浮き一覧（既定=今日から30日先まで） */
export async function getFloating(startDateStr?: string, endDateStr?: string): Promise<FloatingItem[]> {
    const start = toJstDateOnly(startDateStr ?? new Date());
    const end = endDateStr
        ? new Date(toJstDateOnly(endDateStr).getTime() + MS_PER_DAY)
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
