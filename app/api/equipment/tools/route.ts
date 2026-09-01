import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canEditEquipment, canViewEquipment } from '@/lib/equipment';

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toAmount = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/**
 * 機材台帳（電動工具）の一覧。
 * 工具そのものは旧・工具持出しリストの Tool / ToolCategory をそのまま使っている
 * （持出し＝使用者の記録も ToolCheckoutLog を再利用）。
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const [categories, tools, stats] = await Promise.all([
            prisma.toolCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
            prisma.tool.findMany({
                orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
                include: { category: { select: { id: true, name: true } } },
            }),
            prisma.equipmentMaintenanceRecord.groupBy({
                by: ['targetId'],
                where: { targetType: 'tool' },
                _sum: { amount: true },
                _count: { _all: true },
                _max: { date: true },
            }),
        ]);

        // 現在の持出者・持出し先の名前はライブ解決する（当時の記録は ToolCheckoutLog 側に残る）
        const holderIds = [...new Set(tools.map((t) => t.holderId).filter(Boolean))] as string[];
        const pmIds = [...new Set(tools.map((t) => t.projectMasterId).filter(Boolean))] as string[];
        const [holders, pms] = await Promise.all([
            holderIds.length
                ? prisma.user.findMany({ where: { id: { in: holderIds } }, select: { id: true, displayName: true } })
                : Promise.resolve([]),
            pmIds.length
                ? prisma.projectMaster.findMany({ where: { id: { in: pmIds } }, select: { id: true, name: true, title: true } })
                : Promise.resolve([]),
        ]);
        const holderMap = new Map(holders.map((h) => [h.id, h.displayName]));
        const pmMap = new Map(pms.map((p) => [p.id, p.name || p.title]));
        const statMap = new Map(stats.map((s) => [s.targetId, s]));

        return NextResponse.json(
            {
                categories,
                tools: tools.map((t) => {
                    const st = statMap.get(t.id);
                    return {
                        id: t.id,
                        categoryId: t.categoryId,
                        categoryName: t.category.name,
                        name: t.name,
                        status: t.status,
                        maker: t.maker,
                        modelNumber: t.modelNumber,
                        serialNumber: t.serialNumber,
                        purchaseDate: t.purchaseDate,
                        purchasePrice: t.purchasePrice ? Number(t.purchasePrice) : null,
                        holderId: t.holderId,
                        holderName: t.holderId ? holderMap.get(t.holderId) ?? '' : '',
                        projectMasterId: t.projectMasterId,
                        projectName: t.projectMasterId ? pmMap.get(t.projectMasterId) ?? '' : '',
                        destinationNote: t.destinationNote,
                        checkedOutAt: t.checkedOutAt,
                        note: t.note,
                        isActive: t.isActive,
                        maintenance: {
                            count: st?._count._all ?? 0,
                            totalAmount: st?._sum.amount ? Number(st._sum.amount) : 0,
                            lastDate: st?._max.date ?? null,
                        },
                    };
                }),
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('機材台帳（電動工具）の取得', error);
    }
}

/** 電動工具の新規登録。 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const body = await request.json().catch(() => ({}));
        const categoryId = str(body.categoryId, 100);
        const name = str(body.name, 100);
        if (!categoryId) return errorResponse('分類を選んでください', 400);
        if (!name) return errorResponse('名前（管理番号）を入力してください', 400);

        const category = await prisma.toolCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!category) return errorResponse('分類が見つかりません', 400);

        const last = await prisma.tool.findFirst({ where: { categoryId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
        const created = await prisma.tool.create({
            data: {
                categoryId,
                name,
                maker: str(body.maker, 100),
                modelNumber: str(body.modelNumber, 100),
                serialNumber: str(body.serialNumber, 100),
                purchaseDate: toDate(body.purchaseDate),
                purchasePrice: toAmount(body.purchasePrice),
                note: str(body.note, 1000),
                sortOrder: (last?.sortOrder ?? 0) + 1,
            },
        });
        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('電動工具の登録', error);
    }
}
