import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// PATCH: Update a unit price
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const { description, unit, unitPrice, category, templates, notes } = body;

        const updateData: Record<string, unknown> = {};
        if (description !== undefined) updateData.description = description;
        if (unit !== undefined) updateData.unit = unit;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (category !== undefined) updateData.category = category;
        if (templates !== undefined) updateData.templates = JSON.stringify(templates);
        if (notes !== undefined) updateData.notes = notes;

        const updated = await prisma.unitPriceMaster.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({
            ...updated,
            templates: JSON.parse(updated.templates),
        });
    } catch (error) {
        console.error('Failed to update unit price:', error);
        return NextResponse.json({ error: 'Failed to update unit price' }, { status: 500 });
    }
}

// DELETE: Soft delete a unit price
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        await prisma.unitPriceMaster.update({
            where: { id },
            data: { isActive: false },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete unit price:', error);
        return NextResponse.json({ error: 'Failed to delete unit price' }, { status: 500 });
    }
}
