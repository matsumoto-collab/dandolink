import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const [vehicles, tools, settings] = await Promise.all([
            prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
            // 電動工具は機材台帳の Tool をそのまま使う（設定画面の追加・削除も同じテーブル）。
            // 台帳から外した工具・廃棄・紛失も返す（過去の配置に残る工具名を解決するため）。
            // 選択肢から外すのは画面側（lib/equipment.ts の isSchedulableTool）。
            prisma.tool.findMany({
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                include: { category: { select: { id: true, name: true, sortOrder: true } } },
            }),
            prisma.systemSettings.findFirst({ where: { id: 'default' } }),
        ]);

        // Decimal の dailyRate は number|null に正規化して返す（クライアントは number で扱う）
        const vehiclesOut = vehicles.map((v) => ({
            ...v,
            dailyRate: v.dailyRate != null ? Number(v.dailyRate) : null,
        }));

        // スケジュールで選ぶのに要る分だけ（台帳の詳細は /api/equipment/tools が返す）
        const toolsOut = tools.map((t) => ({
            id: t.id,
            name: t.name,
            categoryId: t.categoryId,
            categoryName: t.category.name,
            categorySortOrder: t.category.sortOrder,
            status: t.status,
            sortOrder: t.sortOrder,
            isActive: t.isActive,
        }));

        return NextResponse.json(
            { vehicles: vehiclesOut, tools: toolsOut, totalMembers: settings?.totalMembers || 20 },
            { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60, must-revalidate' } }
        );
    } catch (error) {
        return serverErrorResponse('マスタデータ取得', error);
    }
}
