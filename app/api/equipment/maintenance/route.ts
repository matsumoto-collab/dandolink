import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import {
    canEditEquipment,
    canViewEquipment,
    isEquipmentTargetType,
    isMaintenanceCategory,
} from '@/lib/equipment';
import { withFreshEquipmentFileSignedUrls, MAINTENANCE_FILE_ORDER } from '@/lib/equipmentServer';

/** YYYY-MM-DD を UTC 0時の Date に。日付だけを扱うため時刻は持たない。 */
const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** 金額（税込・0以上）。カンマ入りの入力も受ける。 */
const toAmount = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const toInt = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

/** 履歴＋添付ファイル（署名付きURLは取得のたびに期限を見て作り直す）。 */
async function serialize(record: { files: Parameters<typeof withFreshEquipmentFileSignedUrls>[0][] } & Record<string, unknown>) {
    const files = await Promise.all(record.files.map((f) => withFreshEquipmentFileSignedUrls(f)));
    return { ...record, amount: record.amount == null ? null : Number(record.amount), files };
}

/** 整備・修理履歴の一覧。?targetType=vehicle&targetId=... で機材を絞る（省略時は全件・新しい順）。 */
export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const params = new URL(request.url).searchParams;
        const targetType = params.get('targetType');
        const targetId = params.get('targetId');
        if (targetType && !isEquipmentTargetType(targetType)) return errorResponse('機材の種類が不正です', 400);

        const records = await prisma.equipmentMaintenanceRecord.findMany({
            where: {
                ...(targetType ? { targetType } : {}),
                ...(targetId ? { targetId } : {}),
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            include: { files: { orderBy: MAINTENANCE_FILE_ORDER } },
        });

        const serialized = await Promise.all(records.map((r) => serialize(r as never)));
        return NextResponse.json(serialized, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('整備・修理履歴の取得', error);
    }
}

/** 整備・修理履歴の追加（写真は作成後に /api/equipment/maintenance/[id]/files へ送る）。 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const body = await request.json().catch(() => ({}));
        const targetType = body.targetType;
        const targetId = str(body.targetId, 100);
        const date = toDate(body.date);
        const title = str(body.title, 200);

        if (!isEquipmentTargetType(targetType)) return errorResponse('機材の種類が不正です', 400);
        if (!targetId) return errorResponse('機材が指定されていません', 400);
        if (!date) return errorResponse('日付を入力してください', 400);
        if (!title) return errorResponse('内容を入力してください', 400);

        // 存在しない機材にはぶら下げない（画面のバグで迷子の履歴が増えるのを防ぐ）
        const exists =
            targetType === 'vehicle'
                ? await prisma.vehicle.findUnique({ where: { id: targetId }, select: { id: true } })
                : await prisma.tool.findUnique({ where: { id: targetId }, select: { id: true } });
        if (!exists) return errorResponse('対象の機材が見つかりません', 400);

        const created = await prisma.equipmentMaintenanceRecord.create({
            data: {
                targetType,
                targetId,
                date,
                category: isMaintenanceCategory(body.category) ? body.category : 'repair',
                title,
                vendor: str(body.vendor),
                amount: toAmount(body.amount),
                odometer: toInt(body.odometer),
                nextDueDate: toDate(body.nextDueDate),
                note: str(body.note, 2000),
                createdById: session!.user.id,
                createdByName: session!.user.name ?? null,
            },
            include: { files: { orderBy: MAINTENANCE_FILE_ORDER } },
        });

        return NextResponse.json(await serialize(created as never), { status: 201 });
    } catch (error) {
        return serverErrorResponse('整備・修理履歴の追加', error);
    }
}
