import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse, parseJsonField } from '@/lib/api/utils';

const FOREMAN_ROLES = ['admin', 'manager', 'foreman1', 'foreman2'];

function parseDateOnly(s: string): Date | null {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/**
 * 指定職長×日付の出勤対象メンバー一覧を返す
 * - その日に職長として担当しているアサインメントの confirmedWorkerIds から職方を集約
 * - 職長自身も先頭に含める
 */
export async function GET(req: NextRequest) {
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

        // 職長としての当日アサインメント
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                assignedEmployeeId: foremanId,
                date: { gte: d, lt: new Date(d.getTime() + 24 * 60 * 60 * 1000) },
            },
            select: { confirmedWorkerIds: true, isDispatchConfirmed: true },
        });

        const workerIdSet = new Set<string>();
        workerIdSet.add(foremanId); // 職長自身を追加
        for (const a of assignments) {
            const ids = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            for (const id of ids) {
                if (id) workerIdSet.add(id);
            }
        }

        const userIds = Array.from(workerIdSet);
        if (userIds.length === 0) {
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
        }

        const users = await prisma.user.findMany({
            where: { id: { in: userIds }, isActive: true },
            select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
        });

        // 職長を先頭、その後 dispatchSortOrder → displayName 昇順
        const sorted = users.sort((a, b) => {
            if (a.id === foremanId) return -1;
            if (b.id === foremanId) return 1;
            const ao = a.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
            const bo = b.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return a.displayName.localeCompare(b.displayName, 'ja');
        });

        return NextResponse.json(sorted, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('出勤対象メンバー取得', err);
    }
}
