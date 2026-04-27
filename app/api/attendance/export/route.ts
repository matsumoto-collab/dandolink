import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

const ALLOWED_ROLES = ['admin', 'manager', 'foreman1', 'foreman2'];

function minutesToHours(min: number): number {
    return Math.round((min / 60) * 100) / 100;
}

function calcEarlyEndMinutes(earlyEndTime: string | null): number {
    if (!earlyEndTime) return 0;
    const [h, m] = earlyEndTime.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    const minutes = h * 60 + m;
    const standardEnd = 17 * 60;
    return Math.max(0, standardEnd - minutes);
}

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!ALLOWED_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const url = new URL(req.url);
        const month = url.searchParams.get('month');
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return validationErrorResponse('month=yyyy-mm を指定してください');
        }
        const [y, m] = month.split('-').map(Number);
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));

        const [records, users] = await Promise.all([
            prisma.attendanceRecord.findMany({
                where: { date: { gte: start, lt: end } },
                orderBy: [{ userId: 'asc' }, { date: 'asc' }],
            }),
            prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, displayName: true },
            }),
        ]);

        const userMap = new Map(users.map(u => [u.id, u.displayName]));

        type Totals = {
            displayName: string;
            days: number;
            earlyStart: number;
            morningLoading: number;
            overtime: number;
            eveningLoading: number;
            earlyEnd: number;
        };
        const totals = new Map<string, Totals>();

        for (const r of records) {
            if (r.status !== 'present') continue;
            const t = totals.get(r.userId) ?? {
                displayName: userMap.get(r.userId) ?? r.userId,
                days: 0,
                earlyStart: 0,
                morningLoading: 0,
                overtime: 0,
                eveningLoading: 0,
                earlyEnd: 0,
            };
            t.days += 1;
            t.earlyStart += r.earlyStartMinutes;
            t.morningLoading += r.morningLoadingMinutes;
            t.overtime += r.overtimeMinutes;
            t.eveningLoading += r.eveningLoadingMinutes;
            t.earlyEnd += calcEarlyEndMinutes(r.earlyEndTime);
            totals.set(r.userId, t);
        }

        const header = ['氏名', '出勤日数', '早出(時)', '朝積(時)', '残業(時)', '夕積(時)', '早終(時)'];
        const rows = Array.from(totals.values())
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
            .map(t => [
                t.displayName,
                String(t.days),
                String(minutesToHours(t.earlyStart)),
                String(minutesToHours(t.morningLoading)),
                String(minutesToHours(t.overtime)),
                String(minutesToHours(t.eveningLoading)),
                String(minutesToHours(t.earlyEnd)),
            ]);

        const escape = (v: string) => {
            if (v.includes(',') || v.includes('"') || v.includes('\n')) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
        };
        const csvBody = [header, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
        const bom = '﻿';
        const csv = bom + csvBody;

        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="attendance_${month}.csv"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        return serverErrorResponse('出勤簿エクスポート', err);
    }
}
