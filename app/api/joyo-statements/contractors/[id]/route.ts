import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { joyoContractorUpdateSchema } from '@/lib/validations/joyoStatement';
import { okResponse, requireJoyoAdmin } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/joyo-statements/contractors/[id]
 * 対象者を直す（送られてきた項目だけ変える。出勤簿のユーザーは変えられない。admin 限定）。
 * 単価や宛名を変えても、保存済み・発行済みの明細は変わらない（明細は自分の値と写しを持っている）。
 * 対象者の削除ルートは作らない（「利用中」を外して残す）。
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(joyoContractorUpdateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;

        const existing = await prisma.joyoContractor.findUnique({ where: { id: params.id }, select: { id: true } });
        if (!existing) return notFoundResponse('対象者');

        if (input.payeeId) {
            const payee = await prisma.payee.findUnique({ where: { id: input.payeeId }, select: { id: true } });
            if (!payee) return errorResponse('選んだ振込先が見つかりません', 400);
        }

        // undefined（送られてこなかった項目）は変えない。null は空に戻す
        const data: Prisma.JoyoContractorUpdateInput = { updatedBy: session?.user?.id ?? null };
        if (input.recipientName !== undefined) data.recipientName = input.recipientName;
        if (input.honorific !== undefined) data.honorific = input.honorific;
        if (input.postalCode !== undefined) data.postalCode = input.postalCode;
        if (input.address !== undefined) data.address = input.address;
        if (input.registrationNumber !== undefined) data.registrationNumber = input.registrationNumber;
        if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
        if (input.payeeId !== undefined) data.payeeId = input.payeeId;
        if (input.isActive !== undefined) data.isActive = input.isActive;
        if (input.notes !== undefined) data.notes = input.notes;

        await prisma.joyoContractor.update({ where: { id: existing.id }, data });
        return okResponse(existing.id);
    } catch (error) {
        return serverErrorResponse('支払明細書の対象者の更新', error);
    }
}
