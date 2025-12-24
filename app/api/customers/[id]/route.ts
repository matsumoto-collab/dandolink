import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Update a customer
 * PATCH /api/customers/[id]
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

        // Check if customer exists
        const existingCustomer = await prisma.customer.findUnique({
            where: { id },
        });

        if (!existingCustomer) {
            return NextResponse.json(
                { error: '顧客が見つかりません' },
                { status: 404 }
            );
        }

        // Prepare update data
        const updateData: any = {};

        if (body.name !== undefined) updateData.name = body.name;
        if (body.shortName !== undefined) updateData.shortName = body.shortName || null;
        if (body.contactPersons !== undefined) updateData.contactPersons = body.contactPersons ? JSON.stringify(body.contactPersons) : null;
        if (body.email !== undefined) updateData.email = body.email || null;
        if (body.phone !== undefined) updateData.phone = body.phone || null;
        if (body.fax !== undefined) updateData.fax = body.fax || null;
        if (body.address !== undefined) updateData.address = body.address || null;
        if (body.notes !== undefined) updateData.notes = body.notes || null;

        // Update customer
        const updatedCustomer = await prisma.customer.update({
            where: { id },
            data: updateData,
        });

        // Parse JSON fields for response
        const response = {
            ...updatedCustomer,
            contactPersons: updatedCustomer.contactPersons ? JSON.parse(updatedCustomer.contactPersons) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Update customer error:', error);
        return NextResponse.json(
            { error: '顧客の更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Delete a customer
 * DELETE /api/customers/[id]
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

        // Check if customer exists
        const existingCustomer = await prisma.customer.findUnique({
            where: { id },
        });

        if (!existingCustomer) {
            return NextResponse.json(
                { error: '顧客が見つかりません' },
                { status: 404 }
            );
        }

        // Delete customer
        await prisma.customer.delete({
            where: { id },
        });

        return NextResponse.json({ message: '顧客を削除しました' });
    } catch (error) {
        console.error('Delete customer error:', error);
        return NextResponse.json(
            { error: '顧客の削除に失敗しました' },
            { status: 500 }
        );
    }
}
