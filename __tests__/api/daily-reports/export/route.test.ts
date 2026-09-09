/**
 * @jest-environment node
 */
import { GET } from '@/app/api/daily-reports/export/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest } from 'next/server';

describe('/api/daily-reports/export', () => {
    const managerSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

    const mockUsers = [
        { id: 'f1', displayName: '職長A' },
        { id: 'w1', displayName: '作業員1' },
        { id: 'w2', displayName: '作業員2' },
    ];

    const mockReports = [
        {
            id: 'r1',
            foremanId: 'f1',
            date: new Date('2026-05-10T00:00:00.000Z'),
            notes: '備考,あり',
            workItems: [
                {
                    assignmentId: 'a2',
                    startTime: '08:00',
                    endTime: '17:00',
                    breakMinutes: 60,
                    workerIds: ['w1', 'w2', 'unknown-id'],
                    assignment: {
                        sortOrder: 2,
                        projectMaster: { title: 'タイトル2', name: '第二現場', honorific: '様', customerName: '顧客B' },
                    },
                },
                {
                    assignmentId: 'a1',
                    startTime: null,
                    endTime: null,
                    breakMinutes: null,
                    workerIds: [],
                    assignment: {
                        sortOrder: 1,
                        projectMaster: { title: 'タイトル1', name: null, honorific: null, customerName: null },
                    },
                },
            ],
        },
        {
            id: 'r2',
            foremanId: 'unknown-foreman',
            date: new Date('2026-05-11T00:00:00.000Z'),
            notes: null,
            workItems: [],
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: managerSession, error: null });
        (prisma.dailyReport.findMany as jest.Mock).mockResolvedValue(mockReports);
        (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);
    });

    it('未認証なら requireAuth のエラーレスポンスをそのまま返す', async () => {
        const unauthorized = new Response(JSON.stringify({ error: '認証が必要です' }), { status: 401 });
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: unauthorized });

        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?month=2026-05');
        const res = await GET(req);

        expect(res.status).toBe(401);
        expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
    });

    it('worker ロールは 403', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'user-9', role: 'worker', isActive: true } },
            error: null,
        });

        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?month=2026-05');
        const res = await GET(req);

        expect(res.status).toBe(403);
        expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
    });

    it('パラメータが無ければ 400', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export');
        const res = await GET(req);

        expect(res.status).toBe(400);
        expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
    });

    it('month の形式が不正なら 400', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?month=2026-5');
        const res = await GET(req);

        expect(res.status).toBe(400);
    });

    it('startDate > endDate なら 400', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?startDate=2026-05-31&endDate=2026-05-01');
        const res = await GET(req);

        expect(res.status).toBe(400);
        expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
    });

    it('month 指定: where の期間・CSV本文・ファイル名が正しい', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?month=2026-05');
        const res = await GET(req);

        expect(res.status).toBe(200);

        // 期間 = 月初〜月末（UTC）
        const call = (prisma.dailyReport.findMany as jest.Mock).mock.calls[0][0];
        expect((call.where.date.gte as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
        expect((call.where.date.lte as Date).toISOString()).toBe('2026-05-31T00:00:00.000Z');
        expect(call.where.foremanId).toBeUndefined();
        expect(call.orderBy).toEqual([{ date: 'asc' }, { foremanId: 'asc' }]);
        // 退職者の名前も出せるよう isActive で絞らない
        expect(prisma.user.findMany).toHaveBeenCalledWith({ select: { id: true, displayName: true } });

        expect(res.headers.get('Content-Disposition')).toContain('daily_reports_2026-05.csv');
        expect(res.headers.get('Content-Type')).toContain('text/csv');

        // BOM 付き（res.text() は BOM を落とすのでバイト列で確認する）
        const buf = Buffer.from(await res.arrayBuffer());
        expect(Array.from(buf.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

        const lines = buf.toString('utf8').replace(/^﻿/, '').split('\r\n');
        expect(lines[0]).toBe('日付,職長,案件名,顧客名,開始,終了,休憩(分),実作業(分),実作業(時),作業員,人数,備考');

        // sortOrder 昇順 → 1件目は sortOrder=1（案件名は title フォールバック・時間は空）
        expect(lines[1]).toBe('2026-05-10,職長A,タイトル1,,,,0,,,,0,"備考,あり"');
        // 2件目は sortOrder=2（name+honorific・実作業=480分/8時間・不明IDはそのまま）
        expect(lines[2]).toBe('2026-05-10,職長A,第二現場様,顧客B,08:00,17:00,60,480,8,作業員1、作業員2、unknown-id,3,"備考,あり"');
        // 作業項目0件の日報も1行（案件系の列は空・職長名は未解決ならID）
        expect(lines[3]).toBe('2026-05-11,unknown-foreman,,,,,,,,,,');
        expect(lines).toHaveLength(4);
    });

    it('startDate/endDate 指定: where とファイル名が正しい', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?startDate=2026-05-01&endDate=2026-05-15');
        const res = await GET(req);

        expect(res.status).toBe(200);
        const call = (prisma.dailyReport.findMany as jest.Mock).mock.calls[0][0];
        expect((call.where.date.gte as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
        expect((call.where.date.lte as Date).toISOString()).toBe('2026-05-15T00:00:00.000Z');
        expect(res.headers.get('Content-Disposition')).toContain('daily_reports_2026-05-01_2026-05-15.csv');
    });

    it('foremanId 指定で where.foremanId が付く', async () => {
        const req = new NextRequest('http://localhost:3000/api/daily-reports/export?month=2026-05&foremanId=f1');
        await GET(req);

        const call = (prisma.dailyReport.findMany as jest.Mock).mock.calls[0][0];
        expect(call.where.foremanId).toBe('f1');
    });
});
