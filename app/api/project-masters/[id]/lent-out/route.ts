import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { computeLentOut } from '@/lib/materials/lentOut';

/**
 * GET /api/project-masters/[id]/lent-out
 *
 * 当該案件で「現場に出ている（貸出中）」材料の一覧を返す。
 * 貸出中 = Σ(出庫) − Σ(返却) − Σ(紛失)、対象は status='loaded' の伝票のみ。
 * 詳細な集計ルールは lib/materials/lentOut.ts（単一の正）を参照。
 *
 * Response: LentOutItem[]
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;

        const requisitions = await prisma.materialRequisition.findMany({
            where: { projectMasterId: id, status: 'loaded' },
            select: {
                type: true,
                status: true,
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
                                category: {
                                    select: { name: true, sortOrder: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        const lentOut = computeLentOut(requisitions);

        return NextResponse.json(lentOut, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('貸出中材料取得', error);
    }
}
