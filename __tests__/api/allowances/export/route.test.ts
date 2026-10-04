/**
 * @jest-environment node
 *
 * 手当の CSV の API のテスト（docs/指示書_大規模手当.md の 6-4）。
 *   GET /api/allowances/export?month=YYYY-MM&type=summary   1行＝1人（その月に記録のある人）。admin・manager
 *   GET /api/allowances/export?month=YYYY-MM&type=detail    1行＝1記録（確認待ちも出す）。admin・manager
 *
 * いちばん守りたい約束:
 *   - CSV は、Excel でそのまま開ける形（先頭に BOM が1つ・改行は CRLF・最後の行のあとに改行なし・値の中のカンマ／引用符／改行は引用符で囲む）
 *   - 人が入れた文字（氏名・手当の名前・付けた人・入力元・メモ）が = + - @・タブ・復帰 で始まるときは、頭に ' を付ける
 *     （Excel が「式」として読まないように。数字の列・日付には付けない）
 *   - 集計（summary）の数字は、確定の記録だけ（確認待ちは、件数だけを別の列に出す）。GET /summary と同じ人・同じ並び・同じ数字
 *   - 区分は、社員（給与に付ける分）と、一人親方（支払明細書に載せる分＝JoyoContractor に登録されている人）
 *   - 明細（detail）の手当の名前・金額は、記録に入っている値（今の名前・今の金額を引き直さない）。
 *     並びは、日付の古い順 → 入れた日時の古い順 → ID の小さい順（何度出しても同じ並び）
 *
 * route は、lib/allowances.ts・lib/allowancesServer.ts・lib/allowancesReport.ts の関数を、本物のまま呼ぶ。
 * @/lib/prisma と @/lib/api/utils だけは、jest.setup.ts がモックに差し替えている。
 * このファイルでは、モックの prisma を「小さな DB の代わり」にしてある（beforeEach を参照）:
 *   記録（records）は、渡された where（月の範囲）で絞り、orderBy のとおりに並べて返す。表の中には、ほかの月の記録も入れてある。
 *   人（users）と、支払明細書の対象者（joyoUserIds）も、渡された条件に合うものだけを返す。
 *   だから、「その月の記録だけを出すか」「並びが決まっているか」は、出てきた CSV で確かめられる（大事な条件は、渡した引数でも確かめる）。
 *
 * 日付: 過去の決まった月（2026年9月 など）を使う。この API は「今日」を見ないので、時計は固定しない。
 */
import { NextRequest, NextResponse } from 'next/server';
import * as exportRoute from '@/app/api/allowances/export/route';
import { GET as getSummaryRoute } from '@/app/api/allowances/summary/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { ALLOWANCE_RECORD_SELECT } from '@/lib/allowancesReport';

const { GET } = exportRoute;

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// ---------------------------------------------------------------- ログインしている人

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
/** 管理者でもマネージャーでもない人たち（自分の記録がある人でも、CSV は出せない） */
const OTHERS = [
    { id: 'foremanA', role: 'foreman1', name: '職長A' },
    { id: 'foremanB', role: 'foreman2', name: '職長B' },
    { id: 'worker1', role: 'worker', name: '作業員1' },
    { id: 'partner1', role: 'partner', name: '協力会社' },
    { id: 'partnerMember1', role: 'partner_member', name: '協力会社のメンバー' },
    { id: 'accountant1', role: 'accountant', name: '税理士' },
    { id: 'support1', role: 'support', name: '応援' },
];

// ---------------------------------------------------------------- 呼び方と、応答の読み方

const getExport = (query: string) => GET(new NextRequest(`http://localhost/api/allowances/export?${query}`));
/** 断られたとき（JSON の応答）の読み方 */
const readError = async (res: Response) => ({ status: res.status, body: (await res.json()) as { error?: string; details?: string } });

const BOM = [0xef, 0xbb, 0xbf];
/**
 * CSV の応答の本文を読む。先頭の3バイトが BOM（EF BB BF）であることを確かめて、BOM のあとの文字を返す
 * （res.text() は BOM を落とすことがあるので、バイトで確かめる）
 */
const csvTextOf = async (res: Response): Promise<string> => {
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual(BOM);
    return bytes.subarray(3).toString('utf8');
};
/** その問い合わせの CSV の本文（BOM のあと） */
const csvOf = async (query: string) => csvTextOf(await getExport(query));
/** 行を CRLF でつないだ文字（最後の行のあとに改行なし） */
const crlf = (...lines: string[]) => lines.join('\r\n');
/** 明細の CSV の、見出しを除いた行を、列に分けたもの（値の中にカンマ・改行が無いときだけ使う） */
const detailCells = async (month = '2026-09') => (await csvOf(`month=${month}&type=detail`)).split('\r\n').slice(1).map((line) => line.split(','));

const SUMMARY_HEADER = '氏名,区分,職長（日）,職長（円）,職長以外（日）,職長以外（円）,合計（日）,合計（円）,確認待ち（件）';
const DETAIL_HEADER = '日付,氏名,区分,手当,職長・職長以外,金額,状態,付けた人,入力元,メモ,入力日時';
/** 明細の列の番号 */
const COL = { date: 0, name: 1, kind: 2, item: 3, payRole: 4, amount: 5, status: 6, createdBy: 7, source: 8, note: 9, createdAt: 10 };

/** 形のまちがい（validationErrorResponse）は、モックでは { error: 'Validation Error', details: 文言 } になる */
const INVALID_INPUT = { error: 'Validation Error', details: '入力が不正です' };
const INVALID_MONTH = { error: 'Validation Error', details: '月が不正です' };

// ---------------------------------------------------------------- DB の代わり（表の中身）

/** 人（User）。role は DB の値のまま（大文字が混ざる） */
interface UserRow { id: string; displayName: string; role: string; isActive: boolean; dispatchSortOrder: number | null }
const USERS: UserRow[] = [
    { id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true, dispatchSortOrder: 2 },
    { id: 'joyo1', displayName: '常用の親方1', role: 'worker', isActive: true, dispatchSortOrder: 5 },
    { id: 'retired', displayName: '作業員2（退職）', role: 'WORKER', isActive: false, dispatchSortOrder: 3 },
    { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2', isActive: true, dispatchSortOrder: 1 },
    // 9月に記録の無い人たち（9月の CSV には出ない）
    { id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true, dispatchSortOrder: null },
    { id: 'manager1', displayName: 'マネージャー1', role: 'Manager', isActive: true, dispatchSortOrder: 4 },
    { id: 'joyo2', displayName: '常用の親方2', role: 'worker', isActive: true, dispatchSortOrder: 6 },
];
/** 支払明細書の対象者（JoyoContractor）に登録されている人＝常用の一人親方 */
const JOYO_USER_IDS = ['joyo1', 'joyo2'];

/** 記録の1行（ALLOWANCE_RECORD_SELECT の列） */
interface RecordRow {
    id: string; userId: string; date: Date; itemId: string; itemName: string; payRole: string; amount: number; status: string; source: string;
    note: string | null; createdBy: string; createdByName: string; createdAt: Date; confirmedByName: string | null; confirmedAt: Date | null;
}
/** 既定は「職長A が、その日の出勤簿入力で付けた、確定の記録」（入力日時は、その日の 日本時間 18:00） */
const record = (id: string, dateKey: string, userId: string, payRole: string, amount: number, over: Partial<RecordRow> = {}): RecordRow => ({
    id, userId, date: utc0(dateKey), itemId: 'large', itemName: '大規模手当', payRole, amount, status: 'confirmed', source: 'attendance', note: null,
    createdBy: 'foremanA', createdByName: '職長A', createdAt: new Date(`${dateKey}T09:00:00.000Z`), confirmedByName: null, confirmedAt: null, ...over,
});

/**
 * 2026年9月の記録（ここでは、明細の CSV に出る順＝日付の古い順 → 入れた日時の古い順 に書いてある。表には、逆の順で入れる）。
 *   職長A        … 職長 1日（1,500円）・ほかの人の班に入った日 1日（200円）・自分で付けた確認待ち 1件
 *   作業員1      … 職長以外 3日（月の途中で 200円 → 300円 に変わった）
 *   常用の親方1  … 職長 1日（自分で付けて、認めてもらった分）・職長以外 1日・自分で付けた確認待ち 1件（支払明細書の対象者＝一人親方）
 *   辞めた人     … 職長以外 1日
 *   ghost        … User の行が無い人。職長 1日（手当の名前も金額も、昔のまま入っている）
 */
const SEPTEMBER: RecordRow[] = [
    record('r01', '2026-09-01', 'foremanA', 'foreman', 1500, { status: 'pending' }),
    record('r02', '2026-09-01', 'worker1', 'member', 200, { createdAt: new Date('2026-09-01T09:01:00.000Z') }),
    // 管理者が、あとから「手当の画面」で足した（入力日時は 日本時間 10/1 0:30＝UTC ではまだ 9/30）
    record('r03', '2026-09-02', 'foremanA', 'foreman', 1500, {
        source: 'manual', note: 'あとから足した', createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date('2026-09-30T15:30:00.000Z'),
    }),
    record('r04', '2026-09-02', 'joyo1', 'member', 200, { createdAt: new Date('2026-10-01T00:00:00.000Z') }),
    // 職長A が、職長B の班に入った日（職長以外として 200円）
    record('r05', '2026-09-03', 'foremanA', 'member', 200, { createdBy: 'foremanB', createdByName: '職長B', createdAt: new Date('2026-09-03T08:30:00.000Z') }),
    record('r06', '2026-09-03', 'joyo1', 'foreman', 1500, { status: 'pending', createdBy: 'joyo1', createdByName: '常用の親方1' }),
    // マネージャーが「手配と見比べる」から、まとめて付けた
    record('r07', '2026-09-10', 'worker1', 'member', 200, {
        source: 'bulk', createdBy: 'manager1', createdByName: 'マネージャー1', createdAt: new Date('2026-10-02T01:05:00.000Z'),
    }),
    record('r08', '2026-09-15', 'worker1', 'member', 300),
    record('r09', '2026-09-20', 'ghost', 'foreman', 1000, { itemName: '大規模手当（旧名）', source: 'manual', createdBy: 'admin1', createdByName: '管理者1' }),
    record('r10', '2026-09-25', 'retired', 'member', 200),
    // 常用の親方1 が自分で付けて、あとでマネージャーが認めた（認めた人・認めた日時は、CSV には出さない）
    record('r11', '2026-09-30', 'joyo1', 'foreman', 1500, {
        createdBy: 'joyo1', createdByName: '常用の親方1', confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-10-01T02:00:00.000Z'),
    }),
];
/** ほかの月の記録（月の境目＝8月の末日・10月の1日）。9月の CSV には出ない */
const AUGUST_LAST = record('aug', '2026-08-31', 'worker1', 'member', 180);
const OCTOBER_FIRST = record('oct', '2026-10-01', 'manager1', 'member', 300);

/** 表の中身。テストごとに決める（beforeEach で、「10月の1件 ＋ 9月の11件（逆の順）＋ 8月の1件」に戻す） */
let records: RecordRow[] = [];
let users: UserRow[] = [];
let joyoUserIds: string[] = [];

// ---------------------------------------------------------------- DB の代わり（条件の読み方）

type Row = Record<string, unknown>;
/** 2つの値の大小（日時は時刻で比べる） */
const compare = (a: unknown, b: unknown): number => {
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    if (x === y) return 0;
    return (x as string | number) < (y as string | number) ? -1 : 1;
};
/**
 * Prisma の where を、表の1行に当てはめる（等しい・in・gte・gt・lte・lt だけ）。
 * 表に無い列・知らない条件が来たら例外にする（知らない条件を「全部に当てはまる」と読んで、絞り込みのまちがいを見逃さないため）
 */
const matches = (row: object, where: object | undefined): boolean =>
    Object.entries(where ?? {}).every(([column, condition]: [string, unknown]) => {
        if (!(column in row)) throw new Error(`この表に無い列で絞っています: ${column}`);
        const value = (row as Row)[column];
        if (condition === null || typeof condition !== 'object' || condition instanceof Date) return compare(value, condition) === 0;
        return Object.entries(condition).every(([operator, operand]: [string, unknown]) => {
            if (operator === 'in') return (operand as unknown[]).some((x) => compare(value, x) === 0);
            if (operator === 'gte') return compare(value, operand) >= 0;
            if (operator === 'gt') return compare(value, operand) > 0;
            if (operator === 'lte') return compare(value, operand) <= 0;
            if (operator === 'lt') return compare(value, operand) < 0;
            throw new Error(`この条件の読み方を、テストの DB は知りません: ${column}.${operator}`);
        });
    });
/** Prisma の orderBy（[{ 列: 'asc' | 'desc' }, …]）のとおりに並べる。orderBy が無ければ、表に入っている順のまま */
const sorted = <T extends object>(rows: T[], orderBy: Record<string, 'asc' | 'desc'>[] = []): T[] =>
    [...rows].sort((a, b) => {
        for (const order of orderBy) {
            for (const [column, direction] of Object.entries(order)) {
                const c = compare((a as Row)[column], (b as Row)[column]);
                if (c !== 0) return direction === 'desc' ? -c : c;
            }
        }
        return 0;
    });
interface FindArgs { where?: object; orderBy?: Record<string, 'asc' | 'desc'>[] }

/** user.findMany の where（route と lib が使う3つの形: 在籍 / ID の集まり / そのどちらか） */
interface UserWhere { isActive?: boolean; id?: { in: string[] }; OR?: UserWhere[] }
const userMatches = (where: UserWhere, u: UserRow): boolean =>
    (where.isActive === undefined || u.isActive === where.isActive)
    && (where.id === undefined || where.id.in.includes(u.id))
    && (where.OR === undefined || where.OR.some((w) => userMatches(w, u)));

// ---------------------------------------------------------------- 確かめるための部品

/** DB を何も読んでいないこと */
const noReads = () => {
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceItem.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.joyoContractor.findMany).not.toHaveBeenCalled();
};
/** 手当の6つの表と、書き込みに使う関数（この API は読むだけなので、どれも呼ばれないはず） */
const ALLOWANCE_MODELS = {
    allowanceItem: prisma.allowanceItem,
    allowanceRate: prisma.allowanceRate,
    allowanceRecord: prisma.allowanceRecord,
    allowanceMonthClose: prisma.allowanceMonthClose,
    allowanceLog: prisma.allowanceLog,
    allowanceSetting: prisma.allowanceSetting,
};
const WRITE_METHODS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;
/** 何も書いていないこと（書き込みの鍵も取っていない） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    for (const [name, model] of Object.entries(ALLOWANCE_MODELS)) {
        for (const method of WRITE_METHODS) {
            expect([name, method, mock(model[method]).mock.calls.length]).toEqual([name, method, 0]);
        }
    }
};
/** 記録の findMany に渡した引数（1回目の呼び出し） */
const recordFindArgs = () => mock(prisma.allowanceRecord.findMany).mock.calls[0][0] as { where: unknown; orderBy?: unknown; select: unknown };

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    // 表に入っている順は、CSV に出す順とは、わざと変えてある
    records = [OCTOBER_FIRST, ...[...SEPTEMBER].reverse(), AUGUST_LAST];
    users = USERS;
    joyoUserIds = JOYO_USER_IDS;

    // 記録・人・支払明細書の対象者は、渡された条件に合うものだけを返す（記録は、渡された並びで）
    mock(prisma.allowanceRecord.findMany).mockImplementation(async ({ where, orderBy }: FindArgs) =>
        sorted(records.filter((r) => matches(r, where)), orderBy));
    mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: UserWhere }) => users.filter((u) => userMatches(where, u)));
    mock(prisma.joyoContractor.findMany).mockImplementation(async ({ where }: { where: { userId: { in: string[] } } }) =>
        joyoUserIds.filter((id) => where.userId.in.includes(id)).map((userId) => ({ userId })));
    // 集計（loadAllowanceSummary）が読む、手当の一覧と、締めの行（CSV には出さない）
    mock(prisma.allowanceItem.findMany).mockResolvedValue([{ id: 'large', name: '大規模手当', isActive: true }]);
    mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null);
    // GET /summary（CSV と見比べるために呼ぶ）が読む「終わったのに締めていない月」の材料（CSV には関係しない）
    mock(prisma.allowanceRecord.groupBy).mockResolvedValue([]);
    mock(prisma.allowanceMonthClose.findMany).mockResolvedValue([]);
});

// ================================================================ 権限・入力

describe('GET /api/allowances/export: だれが出せるか（管理者・マネージャーだけ）', () => {
    it('ログインしていなければ 401 のまま返す。何も読まない', async () => {
        // 応答の本文は1回しか読めないので、呼ばれるたびに新しい応答を作る
        mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
        for (const type of ['summary', 'detail']) {
            const r = await readError(await getExport(`month=2026-09&type=${type}`));
            expect([type, r.status, r.body]).toEqual([type, 401, { error: '認証が必要です' }]);
        }
        noReads();
    });

    it.each(OTHERS)('$role は、集計も明細も 403「権限がありません」。何も読まない', async (user) => {
        loginAs(user);
        for (const type of ['summary', 'detail']) {
            const r = await readError(await getExport(`month=2026-09&type=${type}`));
            expect([type, r.status, r.body]).toEqual([type, 403, { error: '権限がありません' }]);
        }
        noReads();
    });

    it('ロールの入っていないセッションも 403（id が管理者のものでも、ロールで決める）', async () => {
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'admin1', name: '管理者1' } }, error: null });
        expect((await getExport('month=2026-09&type=summary')).status).toBe(403);
        noReads();
    });

    it('管理者・マネージャーは、集計も明細も出せる（DB のロールが大文字まじりでも）', async () => {
        for (const user of [ADMIN, MANAGER, { ...ADMIN, role: 'ADMIN' }, { ...MANAGER, role: 'Manager' }]) {
            loginAs(user);
            expect([user.role, (await getExport('month=2026-09&type=summary')).status, (await getExport('month=2026-09&type=detail')).status])
                .toEqual([user.role, 200, 200]);
        }
    });
});

describe('GET /api/allowances/export: 入力の確かめ（合わなければ 400。DB は読まない）', () => {
    it('type が無い・summary でも detail でもない → 400「入力が不正です」', async () => {
        for (const q of ['month=2026-09', 'month=2026-09&type=', 'month=2026-09&type=all', 'month=2026-09&type=Summary', 'month=2026-09&type=DETAIL', 'month=2026-09&type=summary,detail']) {
            const r = await readError(await getExport(q));
            expect([q, r.status, r.body]).toEqual([q, 400, INVALID_INPUT]);
        }
        noReads();
    });

    it('month が無い → 400「入力が不正です」（月は必須。集計も明細も）', async () => {
        for (const q of ['type=summary', 'type=detail', 'type=detail&startDate=2026-09-01&endDate=2026-09-30']) {
            const r = await readError(await getExport(q));
            expect([q, r.status, r.body]).toEqual([q, 400, INVALID_INPUT]);
        }
        noReads();
    });

    it("month の形が違う → 400「月が不正です」（年は 2000〜2999・月は 01〜12。'0026-09' のような年も受け付けない）", async () => {
        for (const month of ['2026-13', '2026-00', '0026-09', '1999-12', '3000-01', '2026-9', '202609', '2026/09', '2026-09-01', '', 'x']) {
            for (const type of ['summary', 'detail']) {
                const q = `month=${month}&type=${type}`;
                const r = await readError(await getExport(q));
                expect([q, r.status, r.body]).toEqual([q, 400, INVALID_MONTH]);
            }
        }
        noReads();
    });
});

// ================================================================ CSV の形

describe('GET /api/allowances/export: CSV の形（集計も明細も同じ）', () => {
    it('添付ファイルとして返す（text/csv・ファイル名に種類と月が入る・no-store）', async () => {
        const summary = await getExport('month=2026-09&type=summary');
        expect(summary.status).toBe(200);
        expect(summary.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
        expect(summary.headers.get('Content-Disposition')).toBe('attachment; filename="allowances_summary_2026-09.csv"');
        expect(summary.headers.get('Cache-Control')).toBe('no-store');

        const detail = await getExport('month=2026-12&type=detail');
        expect(detail.status).toBe(200);
        expect(detail.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
        expect(detail.headers.get('Content-Disposition')).toBe('attachment; filename="allowances_detail_2026-12.csv"');
        expect(detail.headers.get('Cache-Control')).toBe('no-store');
    });

    it.each(['summary', 'detail'])('%s: 本文の先頭に BOM が1つだけ。改行は全部 CRLF で、最後の行のあとに改行なし', async (type) => {
        const bytes = Buffer.from(await (await getExport(`month=2026-09&type=${type}`)).arrayBuffer());
        // 先頭の3バイトが BOM（EF BB BF）。そのあとに、もう1つ BOM が続かない・本文のどこにも BOM の文字が無い
        expect([...bytes.subarray(0, 3)]).toEqual(BOM);
        expect([...bytes.subarray(3, 6)]).not.toEqual(BOM);
        const text = bytes.subarray(3).toString('utf8');
        expect(text).not.toContain('﻿');
        // 見出し ＋ 人数（5人）または記録の件数（11件）の行。CRLF を取り除いたあとに、改行の文字が残らない
        const lines = text.split('\r\n');
        expect(lines).toHaveLength(type === 'summary' ? 1 + 5 : 1 + SEPTEMBER.length);
        expect(lines.join('')).not.toMatch(/[\r\n]/);
        // 最後の行は空ではない（＝最後の行のあとに改行が無い）
        expect(lines[lines.length - 1]).not.toBe('');
        expect(text.endsWith('\n')).toBe(false);
    });

    it('記録が1件も無い月でも、見出しだけの CSV を返す（集計も明細も。見出しのあとに改行なし）', async () => {
        // 表には 8月・9月・10月の記録がある。7月の記録は無い
        const summary = await getExport('month=2026-07&type=summary');
        expect(summary.headers.get('Content-Disposition')).toBe('attachment; filename="allowances_summary_2026-07.csv"');
        expect(await csvTextOf(summary)).toBe(SUMMARY_HEADER);

        const detail = await getExport('month=2026-07&type=detail');
        expect(detail.headers.get('Content-Disposition')).toBe('attachment; filename="allowances_detail_2026-07.csv"');
        expect(await csvTextOf(detail)).toBe(DETAIL_HEADER);
    });
});

// ================================================================ 集計

describe('GET /api/allowances/export?type=summary（1行＝1人）', () => {
    it('その月に記録のある人だけを、並び順（dispatchSortOrder）の小さい順で出す。数字は確定の記録だけ・確認待ちは件数だけ別の列', async () => {
        expect(await csvOf('month=2026-09&type=summary')).toBe(crlf(
            SUMMARY_HEADER,
            // 職長A: 職長 1日 1,500円 ＋ 職長以外 1日 200円。自分で付けた確認待ち（1,500円）は、金額に入れずに件数だけ
            '職長A,社員,1,1500,1,200,2,1700,1',
            // 作業員1: 月の途中で 200円 → 300円 に変わった。記録に入っている金額の足し算（200 + 200 + 300）。8月末日の 180円は入らない
            '作業員1,社員,0,0,3,700,3,700,0',
            // 辞めた人も、その月に記録があれば出す
            '作業員2（退職）,社員,0,0,1,200,1,200,0',
            // 支払明細書の対象者に登録されている人は「一人親方」
            '常用の親方1,一人親方,1,1500,1,200,2,1700,1',
            // User の行が無い人は「（不明）」。並び順が無いので最後
            '（不明）,社員,1,1000,0,0,1,1000,0',
        ));
        // 9月に記録の無い人（管理者・記録の無い一人親方・10/1 にだけ記録のあるマネージャー）は出ない
    });

    it('その月の記録だけを数える（前の月の末日・次の月の1日の記録は、その月の CSV にだけ出る）', async () => {
        expect(await csvOf('month=2026-08&type=summary')).toBe(crlf(SUMMARY_HEADER, '作業員1,社員,0,0,1,180,1,180,0'));
        expect(await csvOf('month=2026-10&type=summary')).toBe(crlf(SUMMARY_HEADER, 'マネージャー1,社員,0,0,1,300,1,300,0'));
    });

    it('読むのは、その月の記録だけ（月の1日（UTC 0時）以上・翌月1日より前）。年をまたぐ12月・うるう年の2月も', async () => {
        const cases: [string, string, string][] = [
            ['2026-09', '2026-09-01', '2026-10-01'],
            ['2026-12', '2026-12-01', '2027-01-01'],
            ['2028-02', '2028-02-01', '2028-03-01'],
        ];
        for (const [month, start, next] of cases) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            expect((await getExport(`month=${month}&type=summary`)).status).toBe(200);
            expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
            expect([month, recordFindArgs().where]).toEqual([month, { date: { gte: utc0(start), lt: utc0(next) } }]);
        }
    });

    it('GET /summary と同じ人・同じ並び・同じ数字（同じ集計を使う）', async () => {
        const summaryRes = await getSummaryRoute(new NextRequest('http://localhost/api/allowances/summary?month=2026-09'));
        expect(summaryRes.status).toBe(200);
        const summary = (await summaryRes.json()) as {
            people: {
                displayName: string; isJoyo: boolean; foremanDays: number; foremanAmount: number; memberDays: number; memberAmount: number;
                totalDays: number; totalAmount: number; pendingCount: number;
            }[];
        };
        expect(summary.people).toHaveLength(5);
        const lines = (await csvOf('month=2026-09&type=summary')).split('\r\n');
        expect(lines.slice(1)).toEqual(summary.people.map((p) => [
            p.displayName, p.isJoyo ? '一人親方' : '社員',
            p.foremanDays, p.foremanAmount, p.memberDays, p.memberAmount, p.totalDays, p.totalAmount, p.pendingCount,
        ].join(',')));
    });

    it('人の並び: 並び順の小さい順（0 も順番あり）→ 並び順の無い人は最後 → 名前の日本語順 → 同じ名前なら人の ID 順（記録の並びによらない）', async () => {
        // ID の順は、名前の順・並び順とは、わざと逆向きにしてある（ID が先に効いたら、順が変わる）
        users = [
            { id: 'u1-ito', displayName: 'いとう', role: 'worker', isActive: true, dispatchSortOrder: null },
            { id: 'twinB', displayName: 'ふたご', role: 'worker', isActive: true, dispatchSortOrder: 3 },
            { id: 'u9-zero', displayName: 'わたなべ', role: 'worker', isActive: true, dispatchSortOrder: 0 },
            { id: 'u2-aoki', displayName: 'アオキ', role: 'worker', isActive: true, dispatchSortOrder: null },
            { id: 'twinA', displayName: 'ふたご', role: 'worker', isActive: true, dispatchSortOrder: 3 },
            { id: 'u8-one', displayName: 'やまだ', role: 'worker', isActive: true, dispatchSortOrder: 1 },
        ];
        // 見分けが付くように、人ごとに金額を変えてある
        const amounts: [string, number][] = [['twinB', 220], ['u1-ito', 240], ['u9-zero', 200], ['twinA', 210], ['u2-aoki', 230], ['u8-one', 250]];
        const rows = amounts.map(([userId, amount], i) => record(`o${i}`, '2026-09-10', userId, 'member', amount));
        const expected = crlf(
            SUMMARY_HEADER,
            'わたなべ,社員,0,0,1,200,1,200,0',   // 並び順 0（名前は最後でも、並び順が先に効く）
            'やまだ,社員,0,0,1,250,1,250,0',     // 並び順 1
            'ふたご,社員,0,0,1,210,1,210,0',     // 並び順 3 の twinA（同じ並び順・同じ名前は、ID の小さいほうが先）
            'ふたご,社員,0,0,1,220,1,220,0',     // 並び順 3 の twinB
            'アオキ,社員,0,0,1,230,1,230,0',     // ここから並び順の無い人（名前の日本語順。カタカナとひらがなは五十音順）
            'いとう,社員,0,0,1,240,1,240,0',
        );
        for (const recordRows of [rows, [...rows].reverse()]) {
            records = recordRows;
            expect(await csvOf('month=2026-09&type=summary')).toBe(expected);
        }
    });

    it('確認待ちしか無い人も1行出す（日数・金額は 0。確認待ちの件数だけ）', async () => {
        records = [
            record('p1', '2026-09-01', 'foremanA', 'foreman', 1500, { status: 'pending' }),
            record('p2', '2026-09-02', 'foremanA', 'foreman', 1500, { status: 'pending' }),
        ];
        expect(await csvOf('month=2026-09&type=summary')).toBe(crlf(SUMMARY_HEADER, '職長A,社員,0,0,0,0,0,0,2'));
    });

    it('区分は、支払明細書の対象者に登録されている人が「一人親方」、それ以外は「社員」（User の行が無い人でも、登録されていれば「一人親方」）', async () => {
        joyoUserIds = ['worker1', 'ghost'];
        expect(await csvOf('month=2026-09&type=summary')).toBe(crlf(
            SUMMARY_HEADER,
            '職長A,社員,1,1500,1,200,2,1700,1',
            '作業員1,一人親方,0,0,3,700,3,700,0',
            '作業員2（退職）,社員,0,0,1,200,1,200,0',
            '常用の親方1,社員,1,1500,1,200,2,1700,1',
            '（不明）,一人親方,1,1000,0,0,1,1000,0',
        ));
    });

    it('氏名の中の カンマ・引用符 は、引用符で囲み、引用符は2つ重ねる（ふつうの名前は囲まない）', async () => {
        users = [
            { id: 'u1', displayName: '田中, 太郎', role: 'worker', isActive: true, dispatchSortOrder: 1 },
            { id: 'u2', displayName: '山田 "ヤマ" 花子', role: 'worker', isActive: true, dispatchSortOrder: 2 },
            { id: 'u3', displayName: '佐藤 次郎（応援・夜間）', role: 'worker', isActive: true, dispatchSortOrder: 3 },
        ];
        records = [
            record('q1', '2026-09-01', 'u1', 'member', 200),
            record('q2', '2026-09-01', 'u2', 'foreman', 1500),
            record('q3', '2026-09-01', 'u3', 'member', 200),
        ];
        expect(await csvOf('month=2026-09&type=summary')).toBe(crlf(
            SUMMARY_HEADER,
            '"田中, 太郎",社員,0,0,1,200,1,200,0',
            '"山田 ""ヤマ"" 花子",社員,1,1500,0,0,1,1500,0',
            '佐藤 次郎（応援・夜間）,社員,0,0,1,200,1,200,0',
        ));
    });

    it("氏名が = + - @ で始まるときは、頭に ' を付ける（Excel が式として読まないように）。数字の列には付けない（マイナスの金額が入っていても、数字のまま）", async () => {
        users = [
            { id: 'u1', displayName: '=山田', role: 'worker', isActive: true, dispatchSortOrder: 1 },
            { id: 'u2', displayName: '+佐藤', role: 'worker', isActive: true, dispatchSortOrder: 2 },
            { id: 'u3', displayName: '-鈴木', role: 'worker', isActive: true, dispatchSortOrder: 3 },
            { id: 'u4', displayName: '@田中', role: 'worker', isActive: true, dispatchSortOrder: 4 },
            // 式に見える名前で、カンマもある → ' を付けたうえで、引用符で囲む
            { id: 'u5', displayName: '=SUM(1,2)', role: 'worker', isActive: true, dispatchSortOrder: 5 },
            // 途中にあるだけなら、付けない
            { id: 'u6', displayName: '高橋@夜間-応援', role: 'worker', isActive: true, dispatchSortOrder: 6 },
        ];
        records = [
            record('q1', '2026-09-01', 'u1', 'member', 200),
            record('q2', '2026-09-01', 'u2', 'foreman', 1500),
            // DB を直に書きかえない限り入らない値（マイナスの金額）。数字の列は、そのまま出す
            record('q3', '2026-09-01', 'u3', 'member', -200),
            record('q4', '2026-09-01', 'u4', 'member', 200, { status: 'pending' }),
            record('q5', '2026-09-01', 'u5', 'member', 200),
            record('q6', '2026-09-01', 'u6', 'member', 200),
        ];
        expect(await csvOf('month=2026-09&type=summary')).toBe(crlf(
            SUMMARY_HEADER,
            "'=山田,社員,0,0,1,200,1,200,0",
            "'+佐藤,社員,1,1500,0,0,1,1500,0",
            "'-鈴木,社員,0,0,1,-200,1,-200,0",
            "'@田中,社員,0,0,0,0,0,0,1",
            '"\'=SUM(1,2)",社員,0,0,1,200,1,200,0',
            '高橋@夜間-応援,社員,0,0,1,200,1,200,0',
        ));
    });
});

// ================================================================ 明細

describe('GET /api/allowances/export?type=detail（1行＝1記録）', () => {
    it('その月の記録を、日付の古い順 → 入れた日時の古い順 に、1記録1行で出す（確認待ちも）。手当の名前・金額は記録に入っている値。区分・職長／職長以外・状態・入力元は、画面の言葉にする', async () => {
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,職長A,社員,大規模手当,職長,1500,確認待ち,職長A,出勤簿入力,,2026-09-01 18:00',
            '2026-09-01,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,,2026-09-01 18:01',
            // 入力日時は日本時間（UTC 9/30 15:30 → 10/1 00:30）。メモも出す
            '2026-09-02,職長A,社員,大規模手当,職長,1500,確定,管理者1,手当の画面,あとから足した,2026-10-01 00:30',
            '2026-09-02,常用の親方1,一人親方,大規模手当,職長以外,200,確定,職長A,出勤簿入力,,2026-10-01 09:00',
            '2026-09-03,職長A,社員,大規模手当,職長以外,200,確定,職長B,出勤簿入力,,2026-09-03 17:30',
            '2026-09-03,常用の親方1,一人親方,大規模手当,職長,1500,確認待ち,常用の親方1,出勤簿入力,,2026-09-03 18:00',
            '2026-09-10,作業員1,社員,大規模手当,職長以外,200,確定,マネージャー1,手配と見比べる,,2026-10-02 10:05',
            '2026-09-15,作業員1,社員,大規模手当,職長以外,300,確定,職長A,出勤簿入力,,2026-09-15 18:00',
            // User の行が無い人は「（不明）」。手当の名前・金額は、記録に入っている昔の値のまま
            '2026-09-20,（不明）,社員,大規模手当（旧名）,職長,1000,確定,管理者1,手当の画面,,2026-09-20 18:00',
            '2026-09-25,作業員2（退職）,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,,2026-09-25 18:00',
            // 付けた人・入力日時は、付けたときのもの（認めた人・認めた日時ではない）
            '2026-09-30,常用の親方1,一人親方,大規模手当,職長,1500,確定,常用の親方1,出勤簿入力,,2026-09-30 18:00',
        ));
    });

    it('その月の記録だけを出す（前の月の末日・次の月の1日の記録は、その月の CSV にだけ出る）', async () => {
        expect(await csvOf('month=2026-08&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-08-31,作業員1,社員,大規模手当,職長以外,180,確定,職長A,出勤簿入力,,2026-08-31 18:00',
        ));
        expect(await csvOf('month=2026-10&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-10-01,マネージャー1,社員,大規模手当,職長以外,300,確定,職長A,出勤簿入力,,2026-10-01 18:00',
        ));
    });

    it('並びは、日付の古い順 → 入れた日時の古い順 → ID の小さい順。「手配と見比べる」でまとめて付けた記録（入れた日時が同じ）も、何度出しても同じ並び（表に入っている順によらない）', async () => {
        /** 9/10 に、マネージャーがまとめて付けた記録（入れた日時が、3件とも同じ）。メモに、記録の ID を入れてある */
        const bulk = (id: string, userId: string) => record(id, '2026-09-10', userId, 'member', 200, {
            source: 'bulk', note: id, createdBy: 'manager1', createdByName: 'マネージャー1', createdAt: new Date('2026-10-02T01:05:00.000Z'),
        });
        const rows = [
            bulk('b3', 'worker1'),
            bulk('b1', 'joyo1'),
            // 次の日の記録。入れた日時は、まとめて付けた記録より前（日付のほうを、先に見る）
            record('a-next', '2026-09-11', 'worker1', 'member', 200, { note: 'a-next', createdAt: new Date('2026-09-11T09:00:00.000Z') }),
            bulk('b2', 'retired'),
            // 同じ 9/10 に、その日のうちに付けた記録。ID は大きいが、入れた日時が先（ID より、入れた日時を先に見る）
            record('z-early', '2026-09-10', 'foremanA', 'foreman', 1500, { note: 'z-early' }),
            // 前の日の記録。入れた日時は、いちばんあと
            record('a-prev', '2026-09-09', 'worker1', 'member', 200, { note: 'a-prev', createdAt: new Date('2026-10-03T00:00:00.000Z') }),
        ];
        for (const table of [rows, [...rows].reverse()]) {
            records = table;
            expect((await detailCells()).map((cells) => cells[COL.note])).toEqual(['a-prev', 'z-early', 'b1', 'b2', 'b3', 'a-next']);
        }
        // DB に渡している並び（最後の決め手が ID）
        expect(recordFindArgs().orderBy).toEqual([{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]);
    });

    it('読むのは、その月の記録だけ（月の1日（UTC 0時）以上・翌月1日より前）。状態では絞らない。年をまたぐ12月・うるう年の2月も', async () => {
        const cases: [string, string, string][] = [
            ['2026-09', '2026-09-01', '2026-10-01'],
            ['2026-12', '2026-12-01', '2027-01-01'],
            ['2028-02', '2028-02-01', '2028-03-01'],
        ];
        for (const [month, start, next] of cases) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            expect((await getExport(`month=${month}&type=detail`)).status).toBe(200);
            expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
            // 状態では絞らない（確認待ちも出す）
            expect([month, recordFindArgs().where]).toEqual([month, { date: { gte: utc0(start), lt: utc0(next) } }]);
            // 1行に要る列（記録に入っている名前・金額・職長／職長以外・状態・入力元・メモ・入力日時 など）を読む
            expect(recordFindArgs().select).toEqual(ALLOWANCE_RECORD_SELECT);
        }
    });

    it('名前と区分は、記録に出てくる人（付けられた人）の ID で引く。在籍かどうか・「使わない」かどうかでは絞らない', async () => {
        expect((await getExport('month=2026-09&type=detail')).status).toBe(200);
        /** 重なりを除いて、並べ替えた ID */
        const uniqueSorted = (list: string[]) => Array.from(new Set(list)).sort();
        const ids = ['foremanA', 'ghost', 'joyo1', 'retired', 'worker1'];
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const userWhere = mock(prisma.user.findMany).mock.calls[0][0].where as { id: { in: string[] } };
        // isActive などの条件を足していない（辞めた人の記録にも、名前を出す）
        expect(userWhere).toEqual({ id: { in: expect.any(Array) } });
        expect(uniqueSorted(userWhere.id.in)).toEqual(ids);
        expect(prisma.joyoContractor.findMany).toHaveBeenCalledTimes(1);
        const joyoWhere = mock(prisma.joyoContractor.findMany).mock.calls[0][0].where as { userId: { in: string[] } };
        // isActive などの条件を足していない（今「使わない」になっている対象者も、一人親方として出す）
        expect(joyoWhere).toEqual({ userId: { in: expect.any(Array) } });
        expect(uniqueSorted(joyoWhere.userId.in)).toEqual(ids);
    });

    it('区分は、支払明細書の対象者に登録されている人が「一人親方」、それ以外は「社員」（User の行が無い人でも、登録されていれば「一人親方」）', async () => {
        joyoUserIds = ['ghost', 'foremanA'];
        records = [
            record('k1', '2026-09-01', 'foremanA', 'foreman', 1500),
            record('k2', '2026-09-01', 'joyo1', 'member', 200),
            record('k3', '2026-09-01', 'ghost', 'member', 200),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,職長A,一人親方,大規模手当,職長,1500,確定,職長A,出勤簿入力,,2026-09-01 18:00',
            '2026-09-01,常用の親方1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,,2026-09-01 18:00',
            '2026-09-01,（不明）,一人親方,大規模手当,職長以外,200,確定,職長A,出勤簿入力,,2026-09-01 18:00',
        ));
    });

    it('入力元: attendance →「出勤簿入力」・manual →「手当の画面」・bulk →「手配と見比べる」・知らない値はそのまま', async () => {
        records = ['attendance', 'manual', 'bulk', 'import', ''].map((source, i) => record(`s${i}`, '2026-09-01', 'worker1', 'member', 200, { source }));
        expect((await detailCells()).map((cells) => cells[COL.source])).toEqual(['出勤簿入力', '手当の画面', '手配と見比べる', 'import', '']);
    });

    it('入力元が constructor・toString・__proto__ などの文字でも、落ちずに、そのまま出す（その月の明細の全体が 500 にならない）', async () => {
        const sources = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];
        records = sources.map((source, i) => record(`s${i}`, '2026-09-01', 'worker1', 'member', 200, { source }));
        const res = await getExport('month=2026-09&type=detail');
        expect(res.status).toBe(200);
        expect((await csvTextOf(res)).split('\r\n').slice(1).map((line) => line.split(',')[COL.source])).toEqual(sources);
    });

    it('DB の知らない文字: 職長・職長以外は「職長以外」に、状態は「確定」にそろえる（金額の大きいほうに見せない・確認待ちに見せない）', async () => {
        records = [
            record('x1', '2026-09-01', 'worker1', 'FOREMAN', 1500, { status: 'PENDING' }),
            record('x2', '2026-09-02', 'worker1', '', 200, { status: '' }),
            record('x3', '2026-09-03', 'worker1', 'foreman', 1500, { status: 'pending' }),
        ];
        expect((await detailCells()).map((cells) => [cells[COL.payRole], cells[COL.amount], cells[COL.status]])).toEqual([
            ['職長以外', '1500', '確定'],
            ['職長以外', '200', '確定'],
            ['職長', '1500', '確認待ち'],
        ]);
    });

    it('入力日時は、日本時間の「YYYY-MM-DD HH:mm」（UTC 15:30 → 翌日 00:30。秒は切り捨て。年をまたぐ日時も）', async () => {
        // [記録の日付, 入れた日時（UTC）, CSV に出る入力日時（日本時間）]
        const times: [string, string, string][] = [
            ['2026-09-10', '2026-09-30T15:30:00.000Z', '2026-10-01 00:30'],
            ['2026-09-11', '2026-09-30T14:59:59.999Z', '2026-09-30 23:59'],
            ['2026-09-12', '2026-09-30T15:00:00.000Z', '2026-10-01 00:00'],
            ['2026-09-13', '2026-09-13T00:05:00.000Z', '2026-09-13 09:05'],
            ['2026-09-14', '2026-12-31T15:00:00.000Z', '2027-01-01 00:00'],
        ];
        records = times.map(([dateKey, iso], i) => record(`t${i}`, dateKey, 'worker1', 'member', 200, { createdAt: new Date(iso) }));
        const cells = await detailCells();
        expect(cells.map((c) => c[COL.createdAt])).toEqual(times.map(([, , jst]) => jst));
        // 日付の列は、記録の日付（入力日時の日付ではない）
        expect(cells.map((c) => c[COL.date])).toEqual(times.map(([dateKey]) => dateKey));
    });

    it('付けた人は、記録に写してある名前のまま出す（その人の今の名前では引き直さない）', async () => {
        records = [
            // 職長A が付けたとき、名前は「職長A（旧姓）」だった（今の名前は「職長A」）
            record('n1', '2026-09-01', 'worker1', 'member', 200, { createdBy: 'foremanA', createdByName: '職長A（旧姓）' }),
            // 職長A 本人も、この月に記録がある（＝今の名前が、氏名の列に出る）
            record('n2', '2026-09-02', 'foremanA', 'foreman', 1500, { createdBy: 'admin1', createdByName: '管理者1' }),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,作業員1,社員,大規模手当,職長以外,200,確定,職長A（旧姓）,出勤簿入力,,2026-09-01 18:00',
            '2026-09-02,職長A,社員,大規模手当,職長,1500,確定,管理者1,出勤簿入力,,2026-09-02 18:00',
        ));
    });

    it('0円の記録は「0」、メモが無い記録は空の欄で出す', async () => {
        records = [record('z1', '2026-09-01', 'worker1', 'member', 0)];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,作業員1,社員,大規模手当,職長以外,0,確定,職長A,出勤簿入力,,2026-09-01 18:00',
        ));
    });

    it('値の中の カンマ・引用符・改行 は、引用符で囲み、引用符は2つ重ねる（氏名・手当の名前・付けた人・メモ）。ほかの値は囲まない', async () => {
        users = [
            ...USERS,
            { id: 'u1', displayName: '田中, 太郎', role: 'worker', isActive: true, dispatchSortOrder: 1 },
            { id: 'u2', displayName: '山田 "ヤマ" 花子', role: 'worker', isActive: true, dispatchSortOrder: 2 },
        ];
        records = [
            record('e1', '2026-09-01', 'u1', 'member', 200, { note: '彼は "職長" です' }),
            record('e2', '2026-09-02', 'u2', 'member', 200, { note: '1行目\n2行目' }),
            record('e3', '2026-09-03', 'u1', 'member', 200, { note: '1行目\r\n2行目' }),
            record('e4', '2026-09-04', 'u2', 'member', 200, { note: '前\r後' }),
            record('e5', '2026-09-05', 'worker1', 'member', 200, { itemName: '大規模手当,旧', createdByName: '職長 "A"', note: '"' }),
            // カンマ・引用符・改行 の無い値（全角のカンマ・空白・かっこ）は、囲まない
            record('e6', '2026-09-06', 'worker1', 'member', 200, { note: ' 雨、午後から（応援） ' }),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,"田中, 太郎",社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"彼は ""職長"" です",2026-09-01 18:00',
            '2026-09-02,"山田 ""ヤマ"" 花子",社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"1行目\n2行目",2026-09-02 18:00',
            '2026-09-03,"田中, 太郎",社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"1行目\r\n2行目",2026-09-03 18:00',
            '2026-09-04,"山田 ""ヤマ"" 花子",社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"前\r後",2026-09-04 18:00',
            '2026-09-05,作業員1,社員,"大規模手当,旧",職長以外,200,確定,"職長 ""A""",出勤簿入力,"""",2026-09-05 18:00',
            '2026-09-06,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力, 雨、午後から（応援） ,2026-09-06 18:00',
        ));
    });
});

describe("GET /api/allowances/export?type=detail: = + - @・タブ・復帰 で始まる値には、頭に ' を付ける（Excel が式として読まないように）", () => {
    beforeEach(() => {
        users = [
            ...USERS,
            { id: 'u-eq', displayName: '=山田', role: 'worker', isActive: true, dispatchSortOrder: 1 },
            { id: 'u-at', displayName: '@佐藤', role: 'worker', isActive: true, dispatchSortOrder: 2 },
        ];
    });

    it("氏名・手当の名前・付けた人・入力元・メモ の、どの列でも付ける（= + - @ のどれで始まっても）", async () => {
        records = [
            record('f1', '2026-09-01', 'u-eq', 'member', 200, { note: '=1+1' }),
            record('f2', '2026-09-02', 'u-at', 'member', 200, { note: '+81-90-0000-0000' }),
            record('f3', '2026-09-03', 'worker1', 'member', 200, { itemName: '+特別手当', createdByName: '-管理者', note: '-5分早退' }),
            record('f4', '2026-09-04', 'worker1', 'member', 200, { itemName: '@現場手当', createdByName: '=SUM', source: '=cmd', note: '@here' }),
            record('f5', '2026-09-05', 'worker1', 'member', 200, { createdByName: '+管理者', source: '-x', note: null }),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            "2026-09-01,'=山田,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,'=1+1,2026-09-01 18:00",
            "2026-09-02,'@佐藤,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,'+81-90-0000-0000,2026-09-02 18:00",
            "2026-09-03,作業員1,社員,'+特別手当,職長以外,200,確定,'-管理者,出勤簿入力,'-5分早退,2026-09-03 18:00",
            "2026-09-04,作業員1,社員,'@現場手当,職長以外,200,確定,'=SUM,'=cmd,'@here,2026-09-04 18:00",
            "2026-09-05,作業員1,社員,大規模手当,職長以外,200,確定,'+管理者,'-x,,2026-09-05 18:00",
        ));
    });

    it("タブ・復帰 で始まる値にも付ける。' を付けたあとで、カンマ・引用符・改行 の決まりどおりに囲む", async () => {
        records = [
            record('g1', '2026-09-01', 'worker1', 'member', 200, { note: '\t=1+1' }),
            record('g2', '2026-09-02', 'worker1', 'member', 200, { note: '\r=1+1' }),
            record('g3', '2026-09-03', 'worker1', 'member', 200, { note: '=HYPERLINK("http://example.com","押す")' }),
            record('g4', '2026-09-04', 'worker1', 'member', 200, { note: '=1+1\n2行目' }),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            "2026-09-01,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,'\t=1+1,2026-09-01 18:00",
            // 復帰（CR）を含むので、引用符で囲む
            '2026-09-02,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"\'\r=1+1",2026-09-02 18:00',
            '2026-09-03,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"\'=HYPERLINK(""http://example.com"",""押す"")",2026-09-03 18:00',
            '2026-09-04,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"\'=1+1\n2行目",2026-09-04 18:00',
        ));
    });

    it("途中に = + - @ があるだけの値には、付けない（ふつうのメモ・名前は、そのまま出す）", async () => {
        const notes = ['1+1=2', 'メモ-1', '田中@現場', '早退（-30分）', 'A=B', '午前のみ +残業'];
        records = notes.map((note, i) => record(`h${i}`, `2026-09-0${i + 1}`, 'worker1', 'member', 200, { note, itemName: '大規模-手当', createdByName: '職長A@1班' }));
        const cells = await detailCells();
        expect(cells.map((c) => c[COL.note])).toEqual(notes);
        expect(cells.map((c) => [c[COL.item], c[COL.createdBy]])).toEqual(notes.map(() => ['大規模-手当', '職長A@1班']));
    });

    it("付けるのは、半角の = + - @・タブ・復帰 で「始まる」値だけ。頭に空白がある値・全角の ＝ ＋ － ＠ で始まる値・改行（LF）で始まる値には、付けない", async () => {
        records = [
            record('w1', '2026-09-01', 'worker1', 'member', 200, { note: ' =1+1' }),
            record('w2', '2026-09-02', 'worker1', 'member', 200, { note: '　=1+1' }), // 頭は、全角の空白
            record('w3', '2026-09-03', 'worker1', 'member', 200, { itemName: '＋特別手当', createdByName: '－管理者', source: '＠x', note: '＝1＋1' }),
            record('w4', '2026-09-04', 'worker1', 'member', 200, { note: '\n=1+1' }),
        ];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            '2026-09-01,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力, =1+1,2026-09-01 18:00',
            '2026-09-02,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,　=1+1,2026-09-02 18:00',
            '2026-09-03,作業員1,社員,＋特別手当,職長以外,200,確定,－管理者,＠x,＝1＋1,2026-09-03 18:00',
            // 改行（LF）を含むので、引用符では囲む（' は付かない）
            '2026-09-04,作業員1,社員,大規模手当,職長以外,200,確定,職長A,出勤簿入力,"\n=1+1",2026-09-04 18:00',
        ));
    });

    it("数字の列（金額）・日付・入力日時・区分・状態には、付けない（マイナスの金額が入っていても、数字のまま）", async () => {
        // DB を直に書きかえない限り入らない値（マイナスの金額）。数字の列まで ' を付けると、Excel で数として足せなくなる
        records = [record('m1', '2026-09-01', 'worker1', 'member', -200, { note: '-200円の調整' })];
        expect(await csvOf('month=2026-09&type=detail')).toBe(crlf(
            DETAIL_HEADER,
            "2026-09-01,作業員1,社員,大規模手当,職長以外,-200,確定,職長A,出勤簿入力,'-200円の調整,2026-09-01 18:00",
        ));
    });
});

// ================================================================ 全体

describe('全体: 設定・読むだけであること・DB が失敗したとき', () => {
    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'。前の月の CSV を使い回さない）", () => {
        expect(exportRoute.dynamic).toBe('force-dynamic');
    });

    it('読むだけ: 集計も明細も、何も書かない・書き込みの鍵も取らない。金額の表（今の金額）も読まない', async () => {
        expect((await getExport('month=2026-09&type=summary')).status).toBe(200);
        expect((await getExport('month=2026-09&type=detail')).status).toBe(200);
        noWrites();
        // 金額は、記録に入っている値を使う（金額の履歴は読まない）
        expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
        // 評価ポイントの記録（別のデータ）も読まない
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
        expect(prisma.evaluationPointItem.findMany).not.toHaveBeenCalled();
    });

    it('DB が失敗したら 500（集計も明細も。途中までの CSV を返したりしない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockRejectedValue(new Error('DB に届かない'));
        for (const type of ['summary', 'detail']) {
            const res = await getExport(`month=2026-09&type=${type}`);
            const r = await readError(res);
            // モックの serverErrorResponse は、渡された操作の名前をそのまま error に入れる（本物は「◯◯に失敗しました」と返す）
            expect([type, r.status, r.body.error]).toEqual([type, 500, '手当の CSV 出力']);
            expect(res.headers.get('Content-Disposition')).toBeNull();
        }
    });

    it('名前・区分が読めなかったときも 500（名前の無い CSV を返したりしない）', async () => {
        mock(prisma.user.findMany).mockRejectedValue(new Error('DB に届かない'));
        expect((await getExport('month=2026-09&type=detail')).status).toBe(500);
        expect((await getExport('month=2026-09&type=summary')).status).toBe(500);

        mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: UserWhere }) => users.filter((u) => userMatches(where, u)));
        mock(prisma.joyoContractor.findMany).mockRejectedValue(new Error('DB に届かない'));
        expect((await getExport('month=2026-09&type=detail')).status).toBe(500);
        expect((await getExport('month=2026-09&type=summary')).status).toBe(500);
    });
});
