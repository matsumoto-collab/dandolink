import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Update an estimate
 * PATCH /api/estimates/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;
        const body = await req.json();

        // Check if estimate exists
        const existingEstimate = await prisma.estimate.findUnique({
            where: { id },
        });

        if (!existingEstimate) {
            return NextResponse.json(
                { error: '見積が見つかりません' },
                { status: 404 }
            );
        }

        // Prepare update data
        const updateData: any = {};

        if (body.projectId !== undefined) updateData.projectId = body.projectId || null;
        if (body.estimateNumber !== undefined) updateData.estimateNumber = body.estimateNumber;
        if (body.title !== undefined) updateData.title = body.title;
        if (body.items !== undefined) updateData.items = JSON.stringify(body.items);
        if (body.subtotal !== undefined) updateData.subtotal = body.subtotal;
        if (body.tax !== undefined) updateData.tax = body.tax;
        if (body.total !== undefined) updateData.total = body.total;
        if (body.validUntil !== undefined) updateData.validUntil = new Date(body.validUntil);
        if (body.status !== undefined) updateData.status = body.status;
        if (body.notes !== undefined) updateData.notes = body.notes || null;

        // Update estimate
        const updatedEstimate = await prisma.estimate.update({
            where: { id },
            data: updateData,
        });

        // Parse JSON fields for response
        const response = {
            ...updatedEstimate,
            items: updatedEstimate.items ? JSON.parse(updatedEstimate.items) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Update estimate error:', error);
        return NextResponse.json(
            { error: '見積の更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Delete an estimate
 * DELETE /api/estimates/[id]
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;

        // Check if estimate exists
        const existingEstimate = await prisma.estimate.findUnique({
            where: { id },
        });

        if (!existingEstimate) {
            return NextResponse.json(
                { error: '見積が見つかりません' },
                { status: 404 }
            );
        }

        // Delete estimate
        await prisma.estimate.delete({
            where: { id },
        });

        return NextResponse.json({ message: '見積を削除しました' });
    } catch (error) {
        console.error('Delete estimate error:', error);
        return NextResponse.json(
            { error: '見積の削除に失敗しました' },
            { status: 500 }
        );
    }
}
