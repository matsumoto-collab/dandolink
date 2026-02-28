import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateCustomerSchema, validateRequest } from '@/lib/validations';
import {
    requireManagerOrAbove,
    parseJsonField,
    stringifyJsonField,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';

// 顧客レコードのJSONフィールドをパース
function parseCustomer<T extends { contactPersons: string | null }>(customer: T) {
    return {
        ...customer,
        contactPersons: parseJsonField(customer.contactPersons, []),
    };
}

/**
 * Update a customer
 * PATCH /api/customers/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = params;
        const body = await req.json();

        // Zodバリデーション
        const validation = validateRequest(updateCustomerSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        // 存在チェック
        const existing = await prisma.customer.findUnique({ where: { id } });
        if (!existing) {
            return notFoundResponse('顧客');
        }

        // 更新データを構築
        const { name, shortName, honorific, contactPersons, email, phone, fax, address, notes } = validation.data;
        const updateData: Record<string, unknown> = {};

        if (name !== undefined) updateData.name = name;
        if (shortName !== undefined) updateData.shortName = shortName || null;
        if (honorific !== undefined) updateData.honorific = honorific;
        if (contactPersons !== undefined) updateData.contactPersons = stringifyJsonField(contactPersons);
        if (email !== undefined) updateData.email = email || null;
        if (phone !== undefined) updateData.phone = phone || null;
        if (fax !== undefined) updateData.fax = fax || null;
        if (address !== undefined) updateData.address = address || null;
        if (notes !== undefined) updateData.notes = notes || null;

        const updated = await prisma.customer.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json(parseCustomer(updated));
    } catch (error) {
        return serverErrorResponse('顧客の更新', error);
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
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = params;

        // 存在チェック
        const existing = await prisma.customer.findUnique({ where: { id } });
        if (!existing) {
            return notFoundResponse('顧客');
        }

        // 参照チェック: この顧客を使用している案件があれば削除を拒否
        const referencingProjects = await prisma.projectMaster.count({ where: { customerId: id } });
        if (referencingProjects > 0) {
            return validationErrorResponse(`この顧客は${referencingProjects}件の案件で使用されているため削除できません`);
        }

        await prisma.customer.delete({ where: { id } });

        return deleteSuccessResponse('顧客');
    } catch (error) {
        return serverErrorResponse('顧客の削除', error);
    }
}
