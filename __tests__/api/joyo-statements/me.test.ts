/**
 * @jest-environment node
 *
 * GET /api/joyo-statements/me（本人の画面: 自分の発行済みの支払明細書だけ）のテスト。
 *
 * prisma のモックは where を見ずにテストが決めた答えを返すだけなので、
 * 「だれの分を読んだか」「下書きを読まないか」は DB の関数に渡した where で確かめる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, dynamic } from '@/app/api/joyo-statements/me/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import type { JoyoMyStatementsResponse } from '@/types/joyoStatement';
import { companyInfoRow, statementRow } from './_fixtures';

const loginAs = (user: { id: string; role?: string | null }) =>
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { isActive: true, ...user } }, error: null });

/** route の GET はリクエストを読まない。クエリを付けても無視されることを見るために、リクエストを渡して呼ぶ */
const callGet = (url = 'http://localhost:3000/api/joyo-statements/me') =>
    (GET as unknown as (req: NextRequest) => Promise<Response>)(new NextRequest(url));

const snapshot = (overrides: Record<string, unknown> = {}) => ({
    title: '支払明細書',
    footerNote: '',
    recipient: { name: '山田工業', honorific: '御中', postalCode: '7900001', address: '愛媛県松山市1-1', registrationNumber: null },
    issuer: { ...companyInfoRow },
    attendanceUserName: '山田 太郎',
    attendanceRecords: [],
    ...overrides,
});

const issuedRow = (overrides: Record<string, unknown> = {}) =>
    statementRow({
        status: 'issued',
        statementNo: '202608-01',
        issuedSnapshot: snapshot(),
        issuedAt: new Date('2026-08-31T03:00:00.000Z'),
        notes: '社内メモ: 先月分の差額あり',
        paymentScheduleId: 'ps-1',
        ...overrides,
    });

beforeEach(() => {
    jest.clearAllMocks();
    loginAs({ id: 'u-1', role: 'foreman1' });
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
    (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([]);
});

describe('GET /api/joyo-statements/me', () => {
    it('対象者でなければ 403 で、明細を読まない（admin でも）', async () => {
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(null);
        for (const role of ['worker', 'foreman2', 'manager', 'admin', 'ADMIN']) {
            loginAs({ id: 'u-9', role });
            const res = await callGet();
            expect([role, res.status]).toEqual([role, 403]);
            expect(await res.json()).toEqual({ error: '支払明細書の対象者として登録されていません' });
        }
        expect(prisma.joyoStatement.findMany).not.toHaveBeenCalled();
    });

    it("対象者は、セッションの id で引き、明細は { contractorId: <自分の対象者の id>, status: 'issued' } で読む", async () => {
        loginAs({ id: 'session-u', role: 'worker' });
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-mine' });
        const res = await callGet();
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect((prisma.joyoContractor.findUnique as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'session-u' });
        expect(prisma.joyoStatement.findMany).toHaveBeenCalledTimes(1);
        expect((prisma.joyoStatement.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
            contractorId: 'c-mine',
            status: 'issued',
        });
    });

    it('クエリに userId・contractorId を付けても、自分の分しか読まない（where が変わらない）', async () => {
        await callGet('http://localhost:3000/api/joyo-statements/me?userId=u-other&contractorId=c-other');
        expect((prisma.joyoContractor.findUnique as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'u-1' });
        expect((prisma.joyoStatement.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
            contractorId: 'c-1',
            status: 'issued',
        });
    });

    it('下書きは返さない（where で絞ったうえ、行が混ざっても落とす）・写しが null や形が違う行は返さない', async () => {
        (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([
            issuedRow({ id: 's-ok' }),
            statementRow({ id: 's-draft', status: 'draft', month: 7 }),
            issuedRow({ id: 's-null', month: 6, issuedSnapshot: null }),
            issuedRow({ id: 's-array', month: 5, issuedSnapshot: [] }),
            issuedRow({ id: 's-string', month: 4, issuedSnapshot: 'broken' }),
            issuedRow({ id: 's-no-recipient', month: 3, issuedSnapshot: snapshot({ recipient: null }) }),
            issuedRow({ id: 's-no-records', month: 2, issuedSnapshot: snapshot({ attendanceRecords: undefined }) }),
        ]);
        const body = (await (await callGet()).json()) as JoyoMyStatementsResponse;
        expect(body.statements.map((s) => s.id)).toEqual(['s-ok']);
    });

    it('応答に notes・paymentScheduleId・attendanceCounts・contractorId・status・updatedAt が入っていない', async () => {
        (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([issuedRow()]);
        const res = await callGet();
        const body = (await res.json()) as JoyoMyStatementsResponse;
        expect(body.userId).toBe('u-1');
        expect(body.statements).toHaveLength(1);
        const s = body.statements[0] as unknown as Record<string, unknown>;
        expect(Object.keys(s).sort()).toEqual(
            [
                'id',
                'year',
                'month',
                'statementNo',
                'issueDate',
                'paymentDate',
                'subject',
                'items',
                'total',
                'tax',
                'includeAttendance',
                'issuedSnapshot',
                'issuedAt',
            ].sort(),
        );
        for (const key of ['notes', 'paymentScheduleId', 'attendanceCounts', 'contractorId', 'status', 'updatedAt']) {
            expect(s).not.toHaveProperty(key);
        }
        const text = JSON.stringify(body);
        expect(text).not.toContain('社内メモ');
        expect(text).not.toContain('ps-1');
        expect(s).toMatchObject({
            id: 's-1',
            year: 2026,
            month: 8,
            statementNo: '202608-01',
            issueDate: '2026-08-31',
            paymentDate: '2026-09-10',
            total: 40000,
            tax: 3636,
            includeAttendance: true,
            issuedAt: '2026-08-31T03:00:00.000Z',
        });
    });

    it('対象月の新しい順（DB の並びが違っても）', async () => {
        (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([
            issuedRow({ id: 'a', year: 2026, month: 2 }),
            issuedRow({ id: 'b', year: 2025, month: 12 }),
            issuedRow({ id: 'c', year: 2026, month: 9 }),
            issuedRow({ id: 'd', year: 2026, month: 10 }),
        ]);
        const body = (await (await callGet()).json()) as JoyoMyStatementsResponse;
        expect(body.statements.map((s) => s.id)).toEqual(['d', 'c', 'a', 'b']);
    });

    it('userId はセッションの id', async () => {
        loginAs({ id: 'session-xyz', role: 'manager' });
        const body = (await (await callGet('http://localhost:3000/api/joyo-statements/me?userId=evil')).json()) as JoyoMyStatementsResponse;
        expect(body).toEqual({ userId: 'session-xyz', statements: [] });
    });

    it('ログインしていなければ 401（DB は読まない）', async () => {
        const unauthorized = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: unauthorized });
        const res = await callGet();
        expect(res.status).toBe(401);
        expect(prisma.joyoContractor.findUnique).not.toHaveBeenCalled();
        expect(prisma.joyoStatement.findMany).not.toHaveBeenCalled();
    });

    it("毎回サーバーで実行する（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
