import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateCustomerSchema, validateRequest } from '@/lib/validations';

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

        // Zodバリデーション
        const validation = validateRequest(updateCustomerSchema, body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error, details: validation.details },
                { status: 400 }
            );
        }

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
        const { name, shortName, contactPersons, email, phone, fax, address, notes } = validation.data;
        const updateData: Record<string, unknown> = {};

        if (name !== undefined) updateData.name = name;
        if (shortName !== undefined) updateData.shortName = shortName || null;
        if (contactPersons !== undefined) updateData.contactPersons = contactPersons ? JSON.stringify(contactPersons) : null;
        if (email !== undefined) updateData.email = email || null;
        if (phone !== undefined) updateData.phone = phone || null;
        if (fax !== undefined) updateData.fax = fax || null;
        if (address !== undefined) updateData.address = address || null;
        if (notes !== undefined) updateData.notes = notes || null;

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
    _req: NextRequest,
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
