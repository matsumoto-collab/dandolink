import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import {
    computeLentOutSummary,
    computeLentOutSites,
    type SiteLentOutRequisitionInput,
} from '@/lib/materials/lentOutByItem';

/**
 * GET /api/materials/lent-out-overview
 *
 * 在庫一覧の「現場別逆引き」を支える品目軸の貸出中集計を一括で返す。
 *   - summary: 品目ごとの貸出中合計（所有総数 = stockQuantity + summary[id] の算出に使う）
 *   - sites  : 現場ごとの貸出中一覧（現場別タブ／品目クリックの逆引きに使う）
 *
 * 貸出中 = Σ(出庫) − Σ(返却) − Σ(紛失)、対象は status='loaded' の伝票のみ。
 * 集計ルールの権威は lib/materials/lentOutByItem.ts（lentOut.ts と同一規則）。
 *
 * Response: { summary: Record<materialItemId, number>, sites: LentOutSite[] }
 *
 * NOTE: loaded 伝票を全件取得して純粋関数で集計する。自社規模では十分だが、
 *       将来データが膨らんだ場合は Prisma groupBy での DB 側集計を検討する。
 */
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const requisitions = await prisma.materialRequisition.findMany({
            where: { status: 'loaded' },
            select: {
                type: true,
                status: true,
                projectMasterId: true,
                foremanName: true,
                date: true,
                items: {
                    select: {
                        materialItemId: true,
                        quantity: true,
                        materialItem: {
                            select: {
                                name: true,
                                spec: true,
                                unit: true,
                                sortOrder: true,
                                category: { select: { name: true, sortOrder: true } },
                            },
                        },
                    },
                },
            },
        });

        // 現場名（ProjectMaster.name || title）を解決
        const projectIds = [...new Set(requisitions.map((r) => r.projectMasterId))];
        const projects = await prisma.projectMaster.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, title: true, name: true },
        });
        const projectMap = new Map(projects.map((p) => [p.id, p.name || p.title || '不明']));

        const inputs: SiteLentOutRequisitionInput[] = requisitions.map((r) => ({
            type: r.type,
            status: r.status,
            projectMasterId: r.projectMasterId,
            projectName: projectMap.get(r.projectMasterId) || '不明',
            foremanName: r.foremanName || null,
            date: r.date.toISOString(),
            items: r.items,
        }));

        const summary = computeLentOutSummary(inputs);
        const sites = computeLentOutSites(inputs);

        return NextResponse.json(
            { summary, sites },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('貸出中サマリー取得', error);
    }
}
