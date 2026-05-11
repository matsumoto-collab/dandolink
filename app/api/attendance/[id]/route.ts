import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';

const ALLOWED_STATUS = ['present', 'absent', 'paid_leave', 'holiday'] as const;
type AttendanceStatus = (typeof ALLOWED_STATUS)[number];

interface RouteContext {
    params: Promise<{ id: string }>;
}

interface PatchBody {
    status?: string;
    earlyStartMinutes?: number;
    morningLoadingMinutes?: number;
    overtimeMinutes?: number;
    eveningLoadingMinutes?: number;
    earlyEndTime?: string | null;
    note?: string | null;
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

/**
 * PATCH /api/attendance/[id]
 * 個人別月次表 から admin が単一レコードを編集する。
 * 出勤区分(status)・早出/朝積/残業/夕積(分)・早終時刻 を更新可能。
 * admin 限定。
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (session!.user.role !== 'admin') {
            return errorResponse('管理者のみ編集できます', 403);
        }

        const { id } = await context.params;
        const existing = await prisma.attendanceRecord.findUnique({ where: { id } });
        if (!existing) return notFoundResponse('出勤簿レコード');

        const body = (await req.json().catch(() => ({}))) as PatchBody;

        const data: Record<string, unknown> = {};
        if (body.status !== undefined) {
            if (!ALLOWED_STATUS.includes(body.status as AttendanceStatus)) {
                return validationErrorResponse('status の値が不正です');
            }
            data.status = body.status;
        }
        if (body.earlyStartMinutes !== undefined) data.earlyStartMinutes = clampMinutes(body.earlyStartMinutes, 600);
        if (body.morningLoadingMinutes !== undefined) data.morningLoadingMinutes = clampMinutes(body.morningLoadingMinutes, 600);
        if (body.overtimeMinutes !== undefined) data.overtimeMinutes = clampMinutes(body.overtimeMinutes, 600);
        if (body.eveningLoadingMinutes !== undefined) data.eveningLoadingMinutes = clampMinutes(body.eveningLoadingMinutes, 600);
        if (body.earlyEndTime !== undefined) data.earlyEndTime = normalizeEarlyEnd(body.earlyEndTime);
        if (body.note !== undefined) data.note = body.note ?? null;

        if (Object.keys(data).length === 0) {
            return validationErrorResponse('更新する項目がありません');
        }

        const updated = await prisma.attendanceRecord.update({
            where: { id },
            data,
        });
        return NextResponse.json(updated, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('出勤簿レコード更新', err);
    }
}

/**
 * DELETE /api/attendance/[id]
 * 個人別月次表 から admin が単一レコードを削除する。
 * admin 限定。
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (session!.user.role !== 'admin') {
            return errorResponse('管理者のみ削除できます', 403);
        }

        const { id } = await context.params;
        const existing = await prisma.attendanceRecord.findUnique({ where: { id } });
        if (!existing) return notFoundResponse('出勤簿レコード');

        await prisma.attendanceRecord.delete({ where: { id } });
        return NextResponse.json({ ok: true, foremanId: existing.foremanId, date: existing.date });
    } catch (err) {
        return serverErrorResponse('出勤簿レコード削除', err);
    }
}
