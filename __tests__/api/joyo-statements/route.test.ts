/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/joyo-statements/route';
import { prisma } from '@/lib/prisma';
import type { JoyoStatementsResponse } from '@/types/joyoStatement';
import {
    asAdmin,
    asManager,
    attendanceRow,
    contractorRow,
    jsonRequest,
    saveBody,
    statementRow,
} from './_fixtures';

const listUrl = (q: string) => new NextRequest(`http://localhost:3000/api/joyo-statements?${q}`);

beforeEach(() => {
    jest.clearAllMocks();
    (prisma.joyoContractor.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoStatementSettings.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.attendanceRecord.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.paymentSchedule.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.payee.findMany as jest.Mock).mockResolvedValue([]);
});

describe('支払明細書 API の権限（admin だけ）', () => {
    it('manager は一覧で 403（DB は読まない）', async () => {
        asManager();
        const res = await GET(listUrl('year=2026&month=8'));
        expect(res.status).toBe(403);
        expect(prisma.joyoContractor.findMany).not.toHaveBeenCalled();
    });

    it('manager は下書き保存で 403（DB は書かない）', async () => {
        asManager();
        const res = await PUT(jsonRequest('/api/joyo-statements', 'PUT', saveBody()));
        expect(res.status).toBe(403);
        expect(prisma.joyoStatement.create).not.toHaveBeenCalled();
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/joyo-statements', () => {
    it('年月が不正なら 400', async () => {
        asAdmin();
        expect((await GET(listUrl('year=2026&month=13'))).status).toBe(400);
        expect((await GET(listUrl('year=abc&month=8'))).status).toBe(400);
        expect(prisma.joyoContractor.findMany).not.toHaveBeenCalled();
    });

    it('対象者2人の行を返し、出勤簿の日数を人ごとに数える（2人の記録を混ぜない）・設定が無ければ既定値', async () => {
        asAdmin();
        (prisma.joyoContractor.findMany as jest.Mock).mockResolvedValue([
            contractorRow(),
            contractorRow({ id: 'c-2', userId: 'u-2', code: 2, sortOrder: 2, recipientName: '佐藤', honorific: '様' }),
        ]);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([
            { id: 'u-1', displayName: '山田 太郎' },
            { id: 'u-2', displayName: '佐藤 次郎' },
        ]);
        // 2人の記録を1回の問い合わせでまとめて返す（u-1: 出勤3日・休日1日／u-2: 出勤1日・夜勤1日）
        (prisma.attendanceRecord.findMany as jest.Mock).mockResolvedValue([
            attendanceRow('u-1', '2026-08-03'),
            attendanceRow('u-1', '2026-08-04'),
            attendanceRow('u-1', '2026-08-05'),
            attendanceRow('u-1', '2026-08-08', 'holiday'),
            attendanceRow('u-2', '2026-08-03'),
            attendanceRow('u-2', '2026-08-04', 'night_shift'),
        ]);
        (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([
            // u-1 の明細は出勤2日を見て保存してある → 今は3日なので「変わっています」
            statementRow({ paymentScheduleId: 'ps-gone' }),
        ]);

        const res = await GET(listUrl('year=2026&month=8'));
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const body = (await res.json()) as JoyoStatementsResponse;

        expect(body.year).toBe(2026);
        expect(body.month).toBe(8);
        expect(body.settings).toEqual({ title: '支払明細書', footerNote: '' });
        expect(body.issuer).toBeNull();
        expect(body.rows).toHaveLength(2);

        const [r1, r2] = body.rows;
        expect(r1.contractor.userDisplayName).toBe('山田 太郎');
        expect(r1.attendance.counts.present).toBe(3);
        expect(r1.attendance.counts.holiday).toBe(1);
        expect(r1.attendance.counts.nightShift).toBe(0);
        expect(r1.attendance.records).toHaveLength(4);
        expect(r1.attendance.records.every((r) => r.userId === 'u-1')).toBe(true);
        // buildAttendanceMonthlyPdfData が split('T')[0] で日付を取るので ISO 文字列
        expect(r1.attendance.records[0].date).toBe('2026-08-03T00:00:00.000Z');
        expect(r1.statement?.issueDate).toBe('2026-08-31');
        expect(r1.attendanceChanged).toBe(true);
        // 支払予定の行が無くなっていれば null（未追加扱い）
        expect(r1.paymentSchedule).toBeNull();

        expect(r2.contractor.userDisplayName).toBe('佐藤 次郎');
        expect(r2.attendance.counts.present).toBe(1);
        expect(r2.attendance.counts.nightShift).toBe(1);
        expect(r2.attendance.counts.holiday).toBe(0);
        expect(r2.statement).toBeNull();
        expect(r2.attendanceChanged).toBe(false);

        // 出勤簿はまとめて1回で取る・ユーザー名は isActive で絞らない
        expect(prisma.attendanceRecord.findMany).toHaveBeenCalledTimes(1);
        const userWhere = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
        expect(userWhere).toEqual({ id: { in: ['u-1', 'u-2'] } });
        // 利用中＋その月の明細がある対象者
        const contractorWhere = (prisma.joyoContractor.findMany as jest.Mock).mock.calls[0][0].where;
        expect(contractorWhere).toEqual({
            OR: [{ isActive: true }, { statements: { some: { year: 2026, month: 8 } } }],
        });
    });

    it('支払予定の行が残っていれば日付と金額（Decimal → 数）を返す', async () => {
        asAdmin();
        (prisma.joyoContractor.findMany as jest.Mock).mockResolvedValue([contractorRow()]);
        (prisma.joyoStatement.findMany as jest.Mock).mockResolvedValue([
            statementRow({ status: 'issued', statementNo: '202608-01', paymentScheduleId: 'ps-1' }),
        ]);
        (prisma.paymentSchedule.findMany as jest.Mock).mockResolvedValue([
            {
                id: 'ps-1',
                paymentDate: new Date('2026-09-10T00:00:00.000Z'),
                amount: { toString: () => '40000.00', valueOf: () => 40000 },
                isPaid: false,
            },
        ]);
        (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue({
            name: '自社',
            postalCode: '7900002',
            address: '住所',
            tel: '089',
            fax: null,
            registrationNumber: null,
        });
        (prisma.joyoStatementSettings.findUnique as jest.Mock).mockResolvedValue({
            id: 'default',
            title: '常用明細',
            footerNote: '注意',
        });

        const body = (await (await GET(listUrl('year=2026&month=8'))).json()) as JoyoStatementsResponse;
        expect(body.settings).toEqual({ title: '常用明細', footerNote: '注意' });
        expect(body.issuer?.name).toBe('自社');
        expect(body.rows[0].paymentSchedule).toEqual({
            id: 'ps-1',
            paymentDate: '2026-09-10',
            amount: 40000,
            isPaid: false,
        });
        // 自社情報は読むだけ（無ければ作る、はしない）
        expect((prisma.companyInfo.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({ id: 'default' });
    });
});

describe('PUT /api/joyo-statements（下書き保存）', () => {
    beforeEach(() => {
        asAdmin();
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        (prisma.joyoStatement.create as jest.Mock).mockResolvedValue({ id: 's-new' });
        (prisma.joyoStatement.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    it('画面から来た amount を使わず、数量×単価で出し直す・attendanceCounts に seenCounts を入れる', async () => {
        const res = await PUT(
            jsonRequest(
                '/api/joyo-statements',
                'PUT',
                saveBody({
                    items: [
                        // amount は 1 円と嘘を送る → 使われない
                        { kind: 'full', name: ' 常用（全日） ', quantity: 22.5, unit: '日', unitPrice: 17350, note: '', amount: 1 },
                        { kind: 'manual', name: '立替', quantity: 1, unit: '式', unitPrice: -3000, note: '', amount: 1 },
                    ],
                    total: 1,
                    seenCounts: { present: 23, holidayWork: 0, nightShift: 0 },
                }),
            ),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-new' });

        const data = (prisma.joyoStatement.create as jest.Mock).mock.calls[0][0].data;
        expect(data.status).toBe('draft');
        expect(data.items).toEqual([
            { kind: 'full', name: '常用（全日）', quantity: 22.5, unit: '日', unitPrice: 17350, note: '', amount: 390375 },
            { kind: 'manual', name: '立替', quantity: 1, unit: '式', unitPrice: -3000, note: '', amount: -3000 },
        ]);
        expect(data.total).toBe(387375);
        expect(data.tax).toBe(Math.trunc((387375 * 10) / 110));
        expect(data.attendanceCounts).toEqual({ present: 23, holidayWork: 0, nightShift: 0 });
        expect(data.issueDate).toEqual(new Date('2026-08-31T00:00:00.000Z'));
        expect(data.updatedBy).toBe('admin-1');
    });

    it('下書きがあれば上書きする（下書きのときだけ）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({ id: 's-1', status: 'draft' });
        const res = await PUT(jsonRequest('/api/joyo-statements', 'PUT', saveBody()));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-1' });
        const arg = (prisma.joyoStatement.updateMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ id: 's-1', status: 'draft' });
        expect(prisma.joyoStatement.create).not.toHaveBeenCalled();
    });

    it('発行済みは 400（書かない）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({ id: 's-1', status: 'issued' });
        const res = await PUT(jsonRequest('/api/joyo-statements', 'PUT', saveBody()));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('発行済みの明細は変更できません');
        expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
        expect(prisma.joyoStatement.create).not.toHaveBeenCalled();
    });

    it('出勤簿の行が同じ種類で2行あれば 400', async () => {
        const res = await PUT(
            jsonRequest(
                '/api/joyo-statements',
                'PUT',
                saveBody({
                    items: [
                        { kind: 'full', name: '常用（全日）', quantity: 1, unit: '日', unitPrice: 20000, note: '' },
                        { kind: 'full', name: '常用（全日）', quantity: 1, unit: '日', unitPrice: 20000, note: '' },
                    ],
                }),
            ),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('種類ごとに1行まで');
        expect(prisma.joyoStatement.create).not.toHaveBeenCalled();
    });

    it('対象者が無ければ 404', async () => {
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await PUT(jsonRequest('/api/joyo-statements', 'PUT', saveBody()));
        expect(res.status).toBe(404);
    });

    it('実在しない日付・空白だけの品名・上限を超える行数は 400', async () => {
        const bad = [
            saveBody({ issueDate: '2026-02-31' }),
            saveBody({ items: [{ kind: 'manual', name: '   ', quantity: 1, unit: '式', unitPrice: 1, note: '' }] }),
            saveBody({
                items: Array.from({ length: 17 }, () => ({
                    kind: 'manual',
                    name: '行',
                    quantity: 1,
                    unit: '式',
                    unitPrice: 1,
                    note: '',
                })),
            }),
        ];
        for (const b of bad) {
            const res = await PUT(jsonRequest('/api/joyo-statements', 'PUT', b));
            expect(res.status).toBe(400);
        }
        expect(prisma.joyoContractor.findUnique).not.toHaveBeenCalled();
    });

    it('金額が大きすぎれば 400', async () => {
        const res = await PUT(
            jsonRequest(
                '/api/joyo-statements',
                'PUT',
                saveBody({
                    items: Array.from({ length: 16 }, () => ({
                        kind: 'manual',
                        name: '行',
                        quantity: 999,
                        unit: '式',
                        unitPrice: 999999,
                        note: '',
                    })),
                }),
            ),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('金額が大きすぎます');
    });
});
