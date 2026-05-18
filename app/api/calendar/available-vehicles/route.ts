import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import { toJstDateOnly } from '@/lib/dateUtils';

/**
 * GET /api/calendar/available-vehicles?date=YYYY-MM-DD&excludeAssignmentId={id}
 *
 * 指定日(JSTカレンダー日)に「空いている車両」と「使用中の車両」を返す。
 * - 使用中: その日のいずれかの assignment の vehicles(車両名の配列) に含まれる車両
 * - excludeAssignmentId: その案件自身の車両は使用中扱いにしない
 *   （同じ案件を移動するだけなので、元の車両も再選択候補に出すため）
 *
 * レスポンス: { available: {id,name}[], inUse: {id,name,usedBy}[] }
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const dateParam = searchParams.get('date');
        const excludeAssignmentId = searchParams.get('excludeAssignmentId') || null;

        if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            return validationErrorResponse('date は YYYY-MM-DD 形式で指定してください');
        }

        const [y, m, d] = dateParam.split('-').map(Number);
        // 保存形式(JST0時=UTC / JST0時=UTC前日15時 の両方)を吸収するため広めの窓で取得し、
        // toJstDateOnly でJSTカレンダー日に正規化して厳密に当日のみへ絞り込む。
        const windowStart = new Date(Date.UTC(y, m - 1, d - 1));
        const windowEnd = new Date(Date.UTC(y, m - 1, d + 2));
        const requestedKey = Date.UTC(y, m - 1, d);

        const assignments = await prisma.projectAssignment.findMany({
            where: { date: { gte: windowStart, lt: windowEnd } },
            select: { id: true, vehicles: true, assignedEmployeeId: true, date: true },
        });

        const sameDay = assignments.filter(
            (a) =>
                toJstDateOnly(a.date).getTime() === requestedKey &&
                a.id !== excludeAssignmentId
        );

        // 職長名解決（usedBy 表示用）
        const foremanIds = Array.from(
            new Set(sameDay.map((a) => a.assignedEmployeeId).filter(Boolean))
        );
        const foremen = foremanIds.length
            ? await prisma.user.findMany({
                where: { id: { in: foremanIds } },
                select: { id: true, displayName: true },
            })
            : [];
        const foremanNameById = new Map(foremen.map((f) => [f.id, f.displayName]));

        // 車両名 -> 使用者(職長)ラベル。最初に見つかった使用者を採用。
        const usedByName = new Map<string, string>();
        for (const a of sameDay) {
            const names = parseJsonField<string[]>(a.vehicles, []);
            const label = foremanNameById.get(a.assignedEmployeeId)
                ? `${foremanNameById.get(a.assignedEmployeeId)}職長`
                : '使用中';
            for (const name of names) {
                if (!usedByName.has(name)) usedByName.set(name, label);
            }
        }

        const masterVehicles = await prisma.vehicle.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });

        const available: { id: string; name: string }[] = [];
        const inUse: { id: string; name: string; usedBy: string }[] = [];
        for (const v of masterVehicles) {
            const usedBy = usedByName.get(v.name);
            if (usedBy) {
                inUse.push({ id: v.id, name: v.name, usedBy });
            } else {
                available.push({ id: v.id, name: v.name });
            }
        }

        return NextResponse.json(
            { available, inUse },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('空き車両取得', error);
    }
}
