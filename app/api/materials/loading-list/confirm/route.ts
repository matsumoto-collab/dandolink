import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';

// 積込リストから出庫確定 → 在庫減算 + 出庫伝票自動作成
export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const { date, vehicleId, items } = body as {
            date: string;
            vehicleId: string;
            items: { materialItemId: string; projectMasterId: string; quantity: number }[];
        };

        if (!date || !vehicleId || !items?.length) {
            return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 });
        }

        // Group items by project for creating requisitions
        const byProject = new Map<string, { materialItemId: string; quantity: number }[]>();
        for (const item of items) {
            if (!byProject.has(item.projectMasterId)) {
                byProject.set(item.projectMasterId, []);
            }
            byProject.get(item.projectMasterId)!.push({
                materialItemId: item.materialItemId,
                quantity: item.quantity,
            });
        }

        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } });

        await prisma.$transaction(async (tx) => {
            for (const [projectMasterId, projectItems] of byProject) {
                // Create requisition per project
                await tx.materialRequisition.create({
                    data: {
                        projectMasterId,
                        date: new Date(date),
                        foremanId: session?.user?.id || '',
                        foremanName: session?.user?.name || '',
                        type: '出庫',
                        status: 'loaded',
                        vehicleInfo: vehicle?.name || '',
                        notes: '積込リストから自動作成',
                        createdBy: session?.user?.id || null,
                        items: {
                            create: projectItems.map(i => ({
                                materialItemId: i.materialItemId,
                                quantity: i.quantity,
                            })),
                        },
                    },
                });

                // Deduct inventory
                for (const item of projectItems) {
                    await tx.materialItem.update({
                        where: { id: item.materialItemId },
                        data: { stockQuantity: { decrement: item.quantity } },
                    });

                    await tx.inventoryTransaction.create({
                        data: {
                            materialItemId: item.materialItemId,
                            quantity: -item.quantity,
                            type: 'dispatch',
                            referenceType: 'loading-list',
                            notes: `積込リスト出庫確定 (${date})`,
                            createdBy: session?.user?.id || null,
                        },
                    });
                }
            }
        });

        return NextResponse.json({ success: true, projectCount: byProject.size });
    } catch (error) {
        return serverErrorResponse('出庫確定', error);
    }
}
