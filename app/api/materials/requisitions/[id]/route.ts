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
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const body = await request.json();

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
