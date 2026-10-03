/**
 * @jest-environment node
 */
import { POST as issue } from '@/app/api/joyo-statements/issue/route';
import { prisma } from '@/lib/prisma';
import { asAdmin, asManager, attendanceRow, companyInfoRow, contractorRow, jsonRequest, saveBody } from './_fixtures';

const issueReq = (body: unknown) => jsonRequest('/api/joyo-statements/issue', 'POST', body);

/** 何も保存していないこと（断るときは何も書かない） */
function expectNothingSaved() {
    expect(prisma.joyoStatement.create).not.toHaveBeenCalled();
    expect(prisma.joyoStatement.update).not.toHaveBeenCalled();
    expect(prisma.joyoStatement.updateMany).not.toHaveBeenCalled();
    expect(prisma.joyoStatement.upsert).not.toHaveBeenCalled();
}

beforeEach(() => {
    jest.clearAllMocks();
    asAdmin();
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(
        contractorRow({ code: 3, registrationNumber: 'T9999999999999' }),
    );
    (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.joyoStatement.create as jest.Mock).mockResolvedValue({ id: 's-new' });
    (prisma.joyoStatement.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(companyInfoRow);
    (prisma.joyoStatementSettings.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ displayName: '山田 太郎' });
    // 出勤2日（画面の seenCounts と同じ）
    (prisma.attendanceRecord.findMany as jest.Mock).mockResolvedValue([
        attendanceRow('u-1', '2026-08-03'),
        attendanceRow('u-1', '2026-08-04'),
    ]);
});

describe('POST /api/joyo-statements/issue', () => {
    it('manager は 403', async () => {
        asManager();
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(403);
        expectNothingSaved();
    });

    it('保存して発行する: statementNo・issuedSnapshot・発行者が入り、attendanceCounts は seenCounts', async () => {
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-new' });

        const data = (prisma.joyoStatement.create as jest.Mock).mock.calls[0][0].data;
        expect(data.status).toBe('issued');
        expect(data.statementNo).toBe('202608-03');
        expect(data.issuedBy).toBe('admin-1');
        expect(data.issuedAt).toBeInstanceOf(Date);
        expect(data.total).toBe(40000);
        expect(data.tax).toBe(3636);
        expect(data.attendanceCounts).toEqual({ present: 2, holidayWork: 0, nightShift: 0 });
        expect(data.issuedSnapshot).toEqual({
            title: '支払明細書',
            footerNote: '',
            recipient: {
                name: '山田工業',
                honorific: '御中',
                postalCode: '7900001',
                address: '愛媛県松山市1-1',
                registrationNumber: 'T9999999999999',
            },
            issuer: companyInfoRow,
            attendanceUserName: '山田 太郎',
            attendanceRecords: [
                expect.objectContaining({ userId: 'u-1', date: '2026-08-03T00:00:00.000Z', status: 'present' }),
                expect.objectContaining({ userId: 'u-1', date: '2026-08-04T00:00:00.000Z', status: 'present' }),
            ],
        });
        // 出勤簿は対象者のユーザーだけ・対象月だけ
        const where = (prisma.attendanceRecord.findMany as jest.Mock).mock.calls[0][0].where;
        expect(where).toEqual({
            userId: { in: ['u-1'] },
            date: { gte: new Date(Date.UTC(2026, 7, 1)), lt: new Date(Date.UTC(2026, 8, 1)) },
        });
    });

    it('発行を取り消した下書きを発行し直しても、書類番号は変えない', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'draft',
            statementNo: '202608-01',
        });
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, id: 's-1' });
        const arg = (prisma.joyoStatement.updateMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ id: 's-1', status: 'draft' });
        expect(arg.data.statementNo).toBe('202608-01');
        expect(arg.data.status).toBe('issued');
    });

    it('2回目の発行は 400（何も保存しない）', async () => {
        (prisma.joyoStatement.findUnique as jest.Mock).mockResolvedValue({
            id: 's-1',
            status: 'issued',
            statementNo: '202608-01',
        });
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('すでに発行済みです');
        expectNothingSaved();
    });

    it('合計 0 円は 400（何も保存しない）', async () => {
        const res = await issue(
            issueReq(
                saveBody({
                    items: [{ kind: 'full', name: '常用（全日）', quantity: 2, unit: '日', unitPrice: 0, note: '' }],
                }),
            ),
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('合計金額が 0 円以下のため発行できません');
        expectNothingSaved();
    });

    it('seenCounts と今の出勤簿が違えば 400（何も保存しない）', async () => {
        (prisma.attendanceRecord.findMany as jest.Mock).mockResolvedValue([
            attendanceRow('u-1', '2026-08-03'),
            attendanceRow('u-1', '2026-08-04'),
            attendanceRow('u-1', '2026-08-05'),
        ]);
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('編集中に出勤簿が変わりました');
        expectNothingSaved();
    });

    it('自社情報が未登録なら 400（何も保存しない）', async () => {
        (prisma.companyInfo.findFirst as jest.Mock).mockResolvedValue(null);
        const res = await issue(issueReq(saveBody()));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('自社情報が登録されていません');
        expectNothingSaved();
    });

    it('PUT と同じ検証に通らなければ 400（出勤簿の行の重複）', async () => {
        const res = await issue(
            issueReq(
                saveBody({
                    items: [
                        { kind: 'night_shift', name: '常用（夜勤）', quantity: 1, unit: '日', unitPrice: 1, note: '' },
                        { kind: 'night_shift', name: '常用（夜勤）', quantity: 1, unit: '日', unitPrice: 1, note: '' },
                    ],
                }),
            ),
        );
        expect(res.status).toBe(400);
        expectNothingSaved();
    });
});
