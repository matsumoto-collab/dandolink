import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const requisition = await prisma.materialRequisition.findUnique({
            where: { id },
            include: {
                items: {
                    include: { materialItem: { include: { category: true } } },
                },
            },
        });

        if (!requisition) {
            return NextResponse.json({ error: '伝票が見つかりません' }, { status: 404 });
        }

        // プロジェクト名取得
        const project = await prisma.projectMaster.findUnique({
            where: { id: requisition.projectMasterId },
            select: { id: true, title: true, name: true },
        });

        return NextResponse.json({
            ...requisition,
            projectTitle: project?.name || project?.title || '不明',
        }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票取得', error);
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const body = await request.json();

        // Get current requisition to check status transition
        const current = await prisma.materialRequisition.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!current) {
            return NextResponse.json({ error: '伝票が見つかりません' }, { status: 404 });
        }

        const data: Record<string, unknown> = {};
        if (body.status !== undefined) data.status = body.status;
        if (body.notes !== undefined) data.notes = body.notes;
        if (body.vehicleInfo !== undefined) data.vehicleInfo = body.vehicleInfo;

        // items の更新がある場合は全置換
        if (body.items && Array.isArray(body.items)) {
            const validItems = body.items.filter((item: { quantity: number }) => item.quantity > 0);

            await prisma.$transaction([
                prisma.materialRequisitionItem.deleteMany({ where: { requisitionId: id } }),
                prisma.materialRequisition.update({
                    where: { id },
                    data: {
                        ...data,
                        items: {
                            create: validItems.map((item: { materialItemId: string; quantity: number; vehicleLabel?: string; notes?: string }) => ({
                                materialItemId: item.materialItemId,
                                quantity: item.quantity,
                                vehicleLabel: item.vehicleLabel || null,
                                notes: item.notes || null,
                            })),
                        },
                    },
                }),
            ]);
        } else {
            await prisma.materialRequisition.update({
                where: { id },
                data,
            });
        }

        // 在庫連動: ステータスが loaded に変更された場合
        const isNewlyLoaded = body.status === 'loaded' && current.status !== 'loaded';
        if (isNewlyLoaded) {
            const reqItems = await prisma.materialRequisitionItem.findMany({
                where: { requisitionId: id },
            });

            const isReturn = current.type === '返却';

            await prisma.$transaction(async (tx) => {
                for (const item of reqItems) {
                    const qty = isReturn ? item.quantity : -item.quantity;
                    await tx.materialItem.update({
                        where: { id: item.materialItemId },
                        data: { stockQuantity: { increment: qty } },
                    });
                    await tx.inventoryTransaction.create({
                        data: {
                            materialItemId: item.materialItemId,
                            quantity: qty,
                            type: isReturn ? 'return' : 'dispatch',
                            referenceId: id,
                            referenceType: 'requisition',
                            createdBy: session?.user?.id || null,
                        },
                    });
                }
            });
        }

        const updated = await prisma.materialRequisition.findUnique({
            where: { id },
            include: { items: { include: { materialItem: true } } },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('材料出庫伝票更新', error);
    }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        await prisma.materialRequisition.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票削除', error);
    }
}
