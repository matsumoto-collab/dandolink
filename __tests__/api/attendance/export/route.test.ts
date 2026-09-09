/**
 * @jest-environment node
 */
import { GET } from '@/app/api/attendance/export/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest } from 'next/server';

describe('/api/attendance/export', () => {
    const managerSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

    const mockRecords = [
        {
            id: 'ar1',
            userId: 'w1',
            date: new Date('2026-05-10T00:00:00.000Z'),
            foremanId: 'f1',
            earlyStartMinutes: 30,
            morningLoadingMinutes: 15,
            overtimeMinutes: 60,
            eveningLoadingMinutes: 0,
            earlyEndTime: '16:00',
            status: 'present',
        },
        {
            id: 'ar2',
            userId: 'w1',
            date: new Date('2026-05-11T00:00:00.000Z'),
            foremanId: 'f1',
            earlyStartMinutes: 0,
            morningLoadingMinutes: 0,
            overtimeMinutes: 0,
            eveningLoadingMinutes: 0,
            earlyEndTime: null,
            status: 'absent', // 集計対象外
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: managerSession, error: null });
        (prisma.attendanceRecord.findMany as jest.Mock).mockResolvedValue(mockRecords);
        (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'w1', displayName: '作業員1' }]);
    });

    it('worker ロールは 403', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({
            session: { user: { id: 'user-9', role: 'worker', isActive: true } },
            error: null,
        });

        const req = new NextRequest('http://localhost:3000/api/attendance/export?month=2026-05');
        const res = await GET(req);

        expect(res.status).toBe(403);
    });

    it('month も startDate/endDate も無ければ 400', async () => {
        const req = new NextRequest('http://localhost:3000/api/attendance/export');
        const res = await GET(req);

        expect(res.status).toBe(400);
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('month 指定（従来動作）: where の gte/lt とファイル名', async () => {
        const req = new NextRequest('http://localhost:3000/api/attendance/export?month=2026-05');
        const res = await GET(req);

        expect(res.status).toBe(200);
        const call = (prisma.attendanceRecord.findMany as jest.Mock).mock.calls[0][0];
        expect((call.where.date.gte as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
        expect((call.where.date.lt as Date).toISOString()).toBe('2026-06-01T00:00:00.000Z');
        expect(res.headers.get('Content-Disposition')).toContain('attendance_2026-05.csv');

        // BOM 付き（res.text() は BOM を落とすのでバイト列で確認する）
        const buf = Buffer.from(await res.arrayBuffer());
        expect(Array.from(buf.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
        const lines = buf.toString('utf8').replace(/^﻿/, '').split('\r\n');
        expect(lines[0]).toBe('氏名,出勤日数,早出(時),朝積(時),残業(時),夕積(時),早終(時)');
        // present の1件のみ集計（早終 = 17:00 - 16:00 = 60分 = 1時間）
        expect(lines[1]).toBe('作業員1,1,0.5,0.25,1,0,1');
    });

    it('startDate/endDate 指定: 終了日の翌日を排他的上限にする', async () => {
        const req = new NextRequest('http://localhost:3000/api/attendance/export?startDate=2026-05-01&endDate=2026-05-15');
        const res = await GET(req);

        expect(res.status).toBe(200);
        const call = (prisma.attendanceRecord.findMany as jest.Mock).mock.calls[0][0];
        expect((call.where.date.gte as Date).toISOString()).toBe('2026-05-01T00:00:00.000Z');
        expect((call.where.date.lt as Date).toISOString()).toBe('2026-05-16T00:00:00.000Z');
        expect(res.headers.get('Content-Disposition')).toContain('attendance_2026-05-01_2026-05-15.csv');
    });

    it('月末指定でも翌月1日が上限になる', async () => {
        const req = new NextRequest('http://localhost:3000/api/attendance/export?startDate=2026-05-20&endDate=2026-05-31');
        await GET(req);

        const call = (prisma.attendanceRecord.findMany as jest.Mock).mock.calls[0][0];
        expect((call.where.date.lt as Date).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    it('startDate > endDate なら 400', async () => {
        const req = new NextRequest('http://localhost:3000/api/attendance/export?startDate=2026-05-31&endDate=2026-05-01');
        const res = await GET(req);

        expect(res.status).toBe(400);
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });
});
