/**
 * 支払明細書（常用で来ている一人親方向け）のサーバー専用の処理。
 *
 * DB（prisma）から一覧の行（対象者＋出勤簿＋明細＋支払予定）を組み立てる処理、DB の行 → 画面の型（DTO）への変換、
 * 設定の既定値、自社情報の読み出し、保存前の金額の計算をここに一本化する。
 * 計算の式そのものは lib/joyoStatement.ts（純粋関数）にあり、ここはそれを呼ぶだけ（同じ式を別の場所に書かない）。
 */
import type { AttendanceRecord, JoyoContractor, JoyoStatement, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    JOYO_LIMITS,
    computeJoyoTotals,
    countJoyoDays,
    hasDuplicateAutoKinds,
    paidDaysChanged,
    recalcItems,
    type JoyoDayCounts,
    type JoyoItemKind,
    type JoyoStatementItem,
} from '@/lib/joyoStatement';
import type { AttendancePdfRecord } from '@/utils/attendanceMonthlyData';
import type { JoyoStatementPdfIssuer } from '@/components/pdf/JoyoStatementPDF';
import type { JoyoStatementSavePayload } from '@/lib/validations/joyoStatement';
import type {
    JoyoContractorDto,
    JoyoIssuedSnapshot,
    JoyoMyStatementDto,
    JoyoPaidDayCounts,
    JoyoStatementAccessMode,
    JoyoStatementDto,
    JoyoStatementRow,
    JoyoStatementStatus,
} from '@/types/joyoStatement';

/** prisma 本体とトランザクション（tx）のどちらでも受けられるように */
type Db = Prisma.TransactionClient;

/** 設定の行（id='default'）が無いときの既定値。マイグレーションで行は入れない（4-1） */
export const JOYO_DEFAULT_SETTINGS = { title: '支払明細書', footerNote: '' } as const;

/** 設定の行の id（1行だけ） */
export const JOYO_SETTINGS_ID = 'default';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 今日（JST）'YYYY-MM-DD'。UTC に 9時間足して UTC の年月日を読む（order-backlog 画面の todayJst と同じ考え方） */
export function todayJstYmd(now: number = Date.now()): string {
    const jst = new Date(now + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → @db.Date に入れる Date（UTC 0時） */
export function toDbDate(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
}

/** @db.Date の値 → 'YYYY-MM-DD'（UTC 0時で入っているのでそのまま切る） */
export function fromDbDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** 出勤簿の月の範囲（app/api/attendance/export/route.ts と同じ Date.UTC の作り方） */
export function attendanceMonthRange(year: number, month: number): { gte: Date; lt: Date } {
    return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
}

/** Prisma の一意制約エラー（P2002）か。jest でも本物のクラスに頼らず判定できるよう code だけを見る */
export function isUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
    );
}

// ---------------------------------------------------------------------------
// 設定・自社情報
// ---------------------------------------------------------------------------

/** 共通設定（行が無ければ既定値で補う） */
export async function loadJoyoSettings(db: Db = prisma): Promise<{ title: string; footerNote: string }> {
    const row = await db.joyoStatementSettings.findUnique({ where: { id: JOYO_SETTINGS_ID } });
    if (!row) return { ...JOYO_DEFAULT_SETTINGS };
    return { title: row.title || JOYO_DEFAULT_SETTINGS.title, footerNote: row.footerNote ?? '' };
}

/**
 * 自社情報（PDF の発行者欄）。未登録なら null。
 * ここでは行を作らない（/api/master-data/company の GET は無ければ作るが、それは真似しない＝指示書 6-2）。
 */
export async function loadJoyoIssuer(db: Db = prisma): Promise<JoyoStatementPdfIssuer | null> {
    const row = await db.companyInfo.findFirst({
        where: { id: 'default' },
        select: { name: true, postalCode: true, address: true, tel: true, fax: true, registrationNumber: true },
    });
    if (!row) return null;
    return {
        name: row.name,
        postalCode: row.postalCode,
        address: row.address,
        tel: row.tel,
        fax: row.fax ?? null,
        registrationNumber: row.registrationNumber ?? null,
    };
}

// ---------------------------------------------------------------------------
// 出勤簿
// ---------------------------------------------------------------------------

type AttendanceRow = Pick<
    AttendanceRecord,
    | 'userId'
    | 'date'
    | 'status'
    | 'earlyStartMinutes'
    | 'morningLoadingMinutes'
    | 'overtimeMinutes'
    | 'eveningLoadingMinutes'
    | 'earlyEndTime'
    | 'note'
>;

/**
 * 出勤簿の1行 → PDF の形。date は ISO 文字列（buildAttendanceMonthlyPdfData が split('T')[0] で日付を取るため）
 */
export function toAttendancePdfRecord(r: AttendanceRow): AttendancePdfRecord {
    return {
        userId: r.userId,
        date: r.date.toISOString(),
        status: r.status,
        earlyStartMinutes: r.earlyStartMinutes,
        morningLoadingMinutes: r.morningLoadingMinutes,
        overtimeMinutes: r.overtimeMinutes,
        eveningLoadingMinutes: r.eveningLoadingMinutes,
        earlyEndTime: r.earlyEndTime ?? null,
        note: r.note ?? null,
    };
}

/**
 * 対象ユーザーぶんの出勤簿（対象月）をまとめて1回で取り、ユーザーごとに分けて返す。
 * countJoyoDays は userId を見ないので、**必ずユーザーごとに分けてから**数える（2人の記録を混ぜない）。
 */
export async function loadMonthAttendanceByUser(
    userIds: string[],
    year: number,
    month: number,
    db: Db = prisma,
): Promise<Map<string, AttendancePdfRecord[]>> {
    const byUser = new Map<string, AttendancePdfRecord[]>();
    for (const id of userIds) byUser.set(id, []);
    if (userIds.length === 0) return byUser;

    const rows = await db.attendanceRecord.findMany({
        where: { userId: { in: userIds }, date: attendanceMonthRange(year, month) },
        orderBy: [{ userId: 'asc' }, { date: 'asc' }],
        select: {
            userId: true,
            date: true,
            status: true,
            earlyStartMinutes: true,
            morningLoadingMinutes: true,
            overtimeMinutes: true,
            eveningLoadingMinutes: true,
            earlyEndTime: true,
            note: true,
        },
    });
    for (const r of rows) {
        const list = byUser.get(r.userId);
        if (list) list.push(toAttendancePdfRecord(r));
    }
    return byUser;
}

/** 金額に関わる日数だけを取り出す */
export function toPaidCounts(counts: JoyoDayCounts): JoyoPaidDayCounts {
    return { present: counts.present, holidayWork: counts.holidayWork, nightShift: counts.nightShift };
}

// ---------------------------------------------------------------------------
// DB の行 → DTO
// ---------------------------------------------------------------------------

/** 振込先の要約（口座番号・名義そのものは返さない） */
type PayeeRow = {
    id: string;
    name: string;
    bankName: string | null;
    branchName: string | null;
    accountNumber: string | null;
    isActive: boolean;
};

/** 「銀行名 支店名」（どちらも無ければ空文字） */
export function payeeBankLabel(p: Pick<PayeeRow, 'bankName' | 'branchName'>): string {
    return [p.bankName, p.branchName]
        .map((s) => (s ?? '').trim())
        .filter((s) => s !== '')
        .join(' ');
}

export function payeeHasAccount(p: Pick<PayeeRow, 'accountNumber'>): boolean {
    return (p.accountNumber ?? '').trim() !== '';
}

const PAYEE_SUMMARY_SELECT = {
    id: true,
    name: true,
    bankName: true,
    branchName: true,
    accountNumber: true,
    isActive: true,
} as const;

export function toContractorDto(
    c: JoyoContractor,
    userDisplayName: string,
    payee: PayeeRow | null,
): JoyoContractorDto {
    return {
        id: c.id,
        userId: c.userId,
        userDisplayName,
        code: c.code,
        recipientName: c.recipientName,
        honorific: c.honorific,
        postalCode: c.postalCode,
        address: c.address,
        registrationNumber: c.registrationNumber,
        unitPrice: c.unitPrice,
        payeeId: c.payeeId,
        payee: payee
            ? {
                  id: payee.id,
                  name: payee.name,
                  bankLabel: payeeBankLabel(payee),
                  hasAccount: payeeHasAccount(payee),
                  isActive: payee.isActive,
              }
            : null,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        notes: c.notes,
    };
}

/**
 * 対象者の DTO をまとめて作る（ユーザー名と振込先はそれぞれ1回で取る）。
 * ユーザー名は isActive で絞らない（利用停止になった人の過去の月も名前を出せるように）。
 */
export async function loadContractorDtos(contractors: JoyoContractor[], db: Db = prisma): Promise<JoyoContractorDto[]> {
    if (contractors.length === 0) return [];
    const userIds = Array.from(new Set(contractors.map((c) => c.userId)));
    const payeeIds = Array.from(new Set(contractors.map((c) => c.payeeId).filter((v): v is string => !!v)));

    const [users, payees] = await Promise.all([
        db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }),
        payeeIds.length > 0
            ? db.payee.findMany({ where: { id: { in: payeeIds } }, select: PAYEE_SUMMARY_SELECT })
            : Promise.resolve([] as PayeeRow[]),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.displayName]));
    const payeeById = new Map(payees.map((p) => [p.id, p]));

    return contractors.map((c) =>
        toContractorDto(c, userName.get(c.userId) ?? '', c.payeeId ? payeeById.get(c.payeeId) ?? null : null),
    );
}

const ITEM_KINDS: readonly JoyoItemKind[] = ['full', 'holiday_work', 'night_shift', 'manual'];

/** Json 列の明細行を型に直す。壊れた値は落とさずに無難な値で補う（画面が落ちないように） */
export function parseStoredItems(value: unknown): JoyoStatementItem[] {
    if (!Array.isArray(value)) return [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return value
        .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v))
        .map((v) => ({
            kind: ITEM_KINDS.includes(v.kind as JoyoItemKind) ? (v.kind as JoyoItemKind) : 'manual',
            name: str(v.name),
            quantity: num(v.quantity),
            unit: str(v.unit),
            unitPrice: num(v.unitPrice),
            amount: num(v.amount),
            note: str(v.note),
        }));
}

/** Json 列の日数（attendanceCounts）を型に直す。形が違えば null（＝比べない） */
export function parsePaidCounts(value: unknown): JoyoPaidDayCounts | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (!ok(v.present) || !ok(v.holidayWork) || !ok(v.nightShift)) return null;
    return { present: v.present, holidayWork: v.holidayWork, nightShift: v.nightShift };
}

/** Json 列の発行時の写し。発行時にサーバーが作った値なので、オブジェクトであればそのまま返す */
function parseSnapshot(value: unknown): JoyoIssuedSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as JoyoIssuedSnapshot;
}

export function toStatementDto(s: JoyoStatement): JoyoStatementDto {
    return {
        id: s.id,
        contractorId: s.contractorId,
        year: s.year,
        month: s.month,
        status: (s.status === 'issued' ? 'issued' : 'draft') as JoyoStatementStatus,
        statementNo: s.statementNo,
        issueDate: fromDbDate(s.issueDate),
        paymentDate: fromDbDate(s.paymentDate),
        subject: s.subject,
        items: parseStoredItems(s.items),
        total: s.total,
        tax: s.tax,
        includeAttendance: s.includeAttendance,
        attendanceCounts: parsePaidCounts(s.attendanceCounts),
        issuedSnapshot: parseSnapshot(s.issuedSnapshot),
        issuedAt: s.issuedAt ? s.issuedAt.toISOString() : null,
        paymentScheduleId: s.paymentScheduleId,
        notes: s.notes,
        updatedAt: s.updatedAt.toISOString(),
    };
}

// ---------------------------------------------------------------------------
// 一覧（GET /api/joyo-statements）
// ---------------------------------------------------------------------------

/**
 * 一覧の行を組み立てる。
 * - 行にする対象者 ＝「利用中の対象者」＋「その月の明細がある対象者（利用停止でも出す）」。並びは sortOrder → code
 * - 出勤簿はまとめて1回で取り、ユーザーごとに分けてから countJoyoDays
 * - paymentSchedule は paymentScheduleId の先の行が実際にあるときだけ（支払予定の側で消されたら「未追加」扱い）
 */
export async function loadJoyoStatementRows(
    year: number,
    month: number,
    today: string,
    db: Db = prisma,
): Promise<JoyoStatementRow[]> {
    const contractors = await db.joyoContractor.findMany({
        where: { OR: [{ isActive: true }, { statements: { some: { year, month } } }] },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    if (contractors.length === 0) return [];

    const contractorIds = contractors.map((c) => c.id);
    const userIds = Array.from(new Set(contractors.map((c) => c.userId)));

    const [dtos, statements, attendanceByUser] = await Promise.all([
        loadContractorDtos(contractors, db),
        db.joyoStatement.findMany({ where: { contractorId: { in: contractorIds }, year, month } }),
        loadMonthAttendanceByUser(userIds, year, month, db),
    ]);

    const statementByContractor = new Map(statements.map((s) => [s.contractorId, s]));
    const scheduleIds = statements.map((s) => s.paymentScheduleId).filter((v): v is string => !!v);
    const schedules =
        scheduleIds.length > 0
            ? await db.paymentSchedule.findMany({
                  where: { id: { in: scheduleIds } },
                  select: { id: true, paymentDate: true, amount: true, isPaid: true },
              })
            : [];
    const scheduleById = new Map(schedules.map((p) => [p.id, p]));

    return dtos.map((contractor) => {
        const records = attendanceByUser.get(contractor.userId) ?? [];
        const counts = countJoyoDays(year, month, records, today);
        const stored = statementByContractor.get(contractor.id);
        const statement = stored ? toStatementDto(stored) : null;
        const ps = stored?.paymentScheduleId ? scheduleById.get(stored.paymentScheduleId) : undefined;
        return {
            contractor,
            attendance: { counts, records },
            statement,
            attendanceChanged: statement ? paidDaysChanged(statement.attendanceCounts, counts) : false,
            paymentSchedule: ps
                ? {
                      id: ps.id,
                      paymentDate: fromDbDate(ps.paymentDate),
                      // Decimal → number
                      amount: Number(ps.amount),
                      isPaid: ps.isPaid,
                  }
                : null,
        };
    });
}

// ---------------------------------------------------------------------------
// 保存（PUT）・発行（issue）で共通の計算
// ---------------------------------------------------------------------------

export type PreparedStatement =
    | { ok: true; items: JoyoStatementItem[]; total: number; tax: number }
    | { ok: false; message: string };

/**
 * 画面から来た明細行の金額を出し直し、合計と内消費税等を計算する（画面から来た amount は使わない）。
 * 出勤簿の行の重複・金額の上限（DB の列が INTEGER）に当たれば断る文言を返す。
 */
export function prepareStatementItems(items: JoyoStatementSavePayload['items']): PreparedStatement {
    if (hasDuplicateAutoKinds(items)) {
        return { ok: false, message: '『常用（全日）』などの出勤簿の行は、種類ごとに1行までです' };
    }
    const recalced = recalcItems(items);
    const { total, tax } = computeJoyoTotals(recalced);
    if (Math.abs(total) > JOYO_LIMITS.maxTotal || recalced.some((it) => Math.abs(it.amount) > JOYO_LIMITS.maxTotal)) {
        return { ok: false, message: '金額が大きすぎます' };
    }
    return { ok: true, items: recalced, total, tax };
}

/** 下書き保存・発行で共通に入れる中身（status などの発行まわりは呼び出し側で足す） */
export function buildStatementWriteData(
    input: JoyoStatementSavePayload,
    prepared: { items: JoyoStatementItem[]; total: number; tax: number },
    userId: string | null,
) {
    return {
        issueDate: toDbDate(input.issueDate),
        paymentDate: toDbDate(input.paymentDate),
        subject: input.subject,
        items: prepared.items as unknown as Prisma.InputJsonValue,
        total: prepared.total,
        tax: prepared.tax,
        includeAttendance: input.includeAttendance,
        // サーバーが数え直した値ではなく、画面に出ていた日数を覚える（3-3）
        attendanceCounts: {
            present: input.seenCounts.present,
            holidayWork: input.seenCounts.holidayWork,
            nightShift: input.seenCounts.nightShift,
        } as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        updatedBy: userId,
    };
}

/** 業務上の断り（トランザクションの中で見つけたとき throw して全体を取り消し、400 で返す） */
export class JoyoRejectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JoyoRejectError';
    }
}

// ---------------------------------------------------------------------------
// 本人の画面（GET /api/joyo-statements/access・GET /api/joyo-statements/me）
// ---------------------------------------------------------------------------

/**
 * 支払明細書の画面の見せ方を決める。
 *  - admin（大文字まじりも）→ 'admin'（管理者の画面）
 *  - それ以外で、支払明細書の対象者（JoyoContractor.userId = userId）の行がある → 'member'（自分の発行済みだけ）
 *  - 行が無い → 'none'
 * 対象者の行は isActive（利用停止）で絞らない（辞めたあとも、自分の過去の書類は見られる）。
 * userId は必ずセッションの id を渡す（画面から来た値を渡さない）。
 */
export async function resolveJoyoAccessMode(
    role: string | null | undefined,
    userId: string | null | undefined,
    db: Db = prisma,
): Promise<JoyoStatementAccessMode> {
    if ((role ?? '').toString().toLowerCase() === 'admin') return 'admin';
    if (!userId) return 'none';
    const contractor = await db.joyoContractor.findUnique({ where: { userId }, select: { id: true } });
    return contractor ? 'member' : 'none';
}

/** 本人に返す形へ。写し（issuedSnapshot）が無い・形が違う・発行済みでない行は null（返さない） */
export function toMyStatementDto(s: JoyoStatement): JoyoMyStatementDto | null {
    const dto = toStatementDto(s);
    if (dto.status !== 'issued' || !isIssuedSnapshot(dto.issuedSnapshot)) return null;
    // 要る項目だけを取り出す（notes・paymentScheduleId・attendanceCounts・contractorId・status・updatedAt は入れない）
    return {
        id: dto.id,
        year: dto.year,
        month: dto.month,
        statementNo: dto.statementNo,
        issueDate: dto.issueDate,
        paymentDate: dto.paymentDate,
        subject: dto.subject,
        items: dto.items,
        total: dto.total,
        tax: dto.tax,
        includeAttendance: dto.includeAttendance,
        issuedSnapshot: dto.issuedSnapshot,
        issuedAt: dto.issuedAt,
    };
}

/** PDF を作るのに要る形がそろっている写しか（宛名・発行者・出勤簿の配列） */
function isIssuedSnapshot(value: JoyoIssuedSnapshot | null): value is JoyoIssuedSnapshot {
    if (!value) return false;
    const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
    return (
        typeof value.title === 'string' &&
        isObj(value.recipient) &&
        typeof value.recipient.name === 'string' &&
        isObj(value.issuer) &&
        typeof value.issuer.name === 'string' &&
        typeof value.attendanceUserName === 'string' &&
        Array.isArray(value.attendanceRecords)
    );
}

/**
 * 本人の発行済みの明細（全部の月・対象月の新しい順）。
 * だれの分かは userId（＝必ずセッションの id）だけで決める。対象者の行が無ければ null（呼び出し側で 403）。
 */
export async function loadMyJoyoStatements(
    userId: string,
    db: Db = prisma,
): Promise<JoyoMyStatementDto[] | null> {
    const contractor = await db.joyoContractor.findUnique({ where: { userId }, select: { id: true } });
    if (!contractor) return null;
    const rows = await db.joyoStatement.findMany({
        where: { contractorId: contractor.id, status: 'issued' },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return rows
        .map(toMyStatementDto)
        .filter((v): v is JoyoMyStatementDto => v !== null)
        // DB の並びに頼らず、ここでも対象月の新しい順にそろえる
        .sort((a, b) => b.year - a.year || b.month - a.month);
}
