import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

const FOREMAN_ROLES = ['admin', 'manager', 'foreman1', 'foreman2'];

const ALLOWED_STATUS = [
    'present',
    'absent',
    'paid_leave',
    'holiday',
    'night_shift',
    'compensatory_holiday',
    'holiday_work',
] as const;
type AttendanceStatus = (typeof ALLOWED_STATUS)[number];

interface AttendanceItemBody {
    userId: string;
    earlyStartMinutes?: number;
    morningLoadingMinutes?: number;
    overtimeMinutes?: number;
    eveningLoadingMinutes?: number;
    earlyEndTime?: string | null; // "HH:mm"
    note?: string | null;
    status?: string; // admin のみ受付
}

interface AttendanceUpsertBody {
    foremanId: string;
    date: string; // yyyy-mm-dd
    items: AttendanceItemBody[];
}

function parseDateOnly(s: string): Date | null {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function clampMinutes(value: unknown, max = 600): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(max, Math.round(n));
}

function normalizeEarlyEnd(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') return null;
    if (!/^\d{2}:\d{2}$/.test(value)) return null;
    return value;
}

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!FOREMAN_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const url = new URL(req.url);
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const foremanId = url.searchParams.get('foremanId');
        const date = url.searchParams.get('date');

        const where: {
            date?: { gte?: Date; lte?: Date; lt?: Date };
            foremanId?: string;
        } = {};

        if (date) {
            const d = parseDateOnly(date);
            if (!d) return validationErrorResponse('date が不正です');
            where.date = { gte: d, lt: new Date(d.getTime() + 24 * 60 * 60 * 1000) };
        } else if (startDate || endDate) {
            const range: { gte?: Date; lte?: Date } = {};
            if (startDate) {
                const s = parseDateOnly(startDate);
                if (!s) return validationErrorResponse('startDate が不正です');
                range.gte = s;
            }
            if (endDate) {
                const e = parseDateOnly(endDate);
                if (!e) return validationErrorResponse('endDate が不正です');
                range.lte = e;
            }
            where.date = range;
        }

        if (foremanId) where.foremanId = foremanId;

        const records = await prisma.attendanceRecord.findMany({
            where,
            orderBy: [{ date: 'desc' }, { foremanId: 'asc' }, { userId: 'asc' }],
        });

        return NextResponse.json(records, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('出勤簿取得', err);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!FOREMAN_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const body = (await req.json()) as AttendanceUpsertBody;
        if (!body || !body.foremanId || !body.date || !Array.isArray(body.items)) {
            return validationErrorResponse('foremanId / date / items が必要です');
        }

        const dateOnly = parseDateOnly(body.date);
        if (!dateOnly) return validationErrorResponse('date が不正です');

        const currentUserId = session!.user.id as string;

        // 職長は自分が foremanId のレコードのみ操作可（admin/manager は誰でも）
        if ((role === 'foreman1' || role === 'foreman2') && body.foremanId !== currentUserId) {
            return errorResponse('他職長の出勤簿は編集できません', 403);
        }

        // バルクupsert
        const isAdmin = role === 'admin';
        const ops = body.items.map(item => {
            const adminStatus =
                isAdmin && typeof item.status === 'string' && ALLOWED_STATUS.includes(item.status as AttendanceStatus)
                    ? (item.status as AttendanceStatus)
                    : undefined;
            const baseData = {
                userId: item.userId,
                date: dateOnly,
                foremanId: body.foremanId,
                earlyStartMinutes: clampMinutes(item.earlyStartMinutes, 600),
                morningLoadingMinutes: clampMinutes(item.morningLoadingMinutes, 600),
                overtimeMinutes: clampMinutes(item.overtimeMinutes, 600),
                eveningLoadingMinutes: clampMinutes(item.eveningLoadingMinutes, 600),
                earlyEndTime: normalizeEarlyEnd(item.earlyEndTime),
                note: item.note ?? null,
                createdBy: currentUserId,
            };
            // status は admin の場合のみ更新対象に含める
            const updateData = adminStatus ? { ...baseData, status: adminStatus } : baseData;
            const createData = adminStatus ? { ...baseData, status: adminStatus } : baseData;
            return prisma.attendanceRecord.upsert({
                where: { userId_date: { userId: item.userId, date: dateOnly } },
                update: updateData,
                create: createData,
            });
        });

        const results = await prisma.$transaction(ops);
        return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('出勤簿保存', err);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!FOREMAN_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const url = new URL(req.url);
        const foremanId = url.searchParams.get('foremanId');
        const date = url.searchParams.get('date');
        if (!foremanId || !date) return validationErrorResponse('foremanId と date が必要です');

        const d = parseDateOnly(date);
        if (!d) return validationErrorResponse('date が不正です');

        const currentUserId = session!.user.id as string;
        if ((role === 'foreman1' || role === 'foreman2') && foremanId !== currentUserId) {
            return errorResponse('他職長の出勤簿は削除できません', 403);
        }

        await prisma.attendanceRecord.deleteMany({
            where: { foremanId, date: d },
        });
        return NextResponse.json({ ok: true });
    } catch (err) {
        return serverErrorResponse('出勤簿削除', err);
    }
}
