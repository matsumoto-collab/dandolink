import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;

        const items = await prisma.projectMaterialItem.findMany({
            where: { projectMasterId: id },
            include: {
                materialItem: {
                    include: { category: { select: { id: true, name: true, sortOrder: true } } },
                },
            },
            orderBy: { materialItem: { sortOrder: 'asc' } },
        });

        return NextResponse.json(items, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('案件材料表取得', error);
    }
}

// Bulk upsert - replaces all material items for a project
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const body = await request.json();
        const { items } = body as {
            items: { materialItemId: string; requiredQuantity: number; notes?: string }[];
        };

        if (!items || !Array.isArray(items)) {
            return NextResponse.json({ error: '材料データが不正です' }, { status: 400 });
        }

        // Filter to items with quantity > 0
        const validItems = items.filter(i => i.requiredQuantity > 0);

        await prisma.$transaction(async (tx) => {
            // Delete all existing items for this project
            await tx.projectMaterialItem.deleteMany({
                where: { projectMasterId: id },
            });

            // Create new items
            if (validItems.length > 0) {
                await tx.projectMaterialItem.createMany({
                    data: validItems.map(i => ({
                        projectMasterId: id,
                        materialItemId: i.materialItemId,
                        requiredQuantity: i.requiredQuantity,
                        notes: i.notes || null,
                    })),
                });
            }
        });

        // Return updated list
        const updated = await prisma.projectMaterialItem.findMany({
            where: { projectMasterId: id },
            include: {
                materialItem: {
                    include: { category: { select: { id: true, name: true, sortOrder: true } } },
                },
            },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('案件材料表更新', error);
    }
}
