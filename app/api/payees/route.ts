import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createPayeeSchema, validateRequest } from '@/lib/validations';
import {
    requireAdmin,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';

/**
 * Get all payees
 * GET /api/payees
 * クエリ: ?activeOnly=1 で利用中のみ
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get('activeOnly') === '1';

        const payees = await prisma.payee.findMany({
            where: activeOnly ? { isActive: true } : undefined,
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(payees, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('振込先一覧の取得', error);
    }
}

/**
 * Create a new payee
 * POST /api/payees
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const body = await req.json();

        const validation = validateRequest(createPayeeSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const data = validation.data;

        const newPayee = await prisma.payee.create({
            data: {
                name: data.name,
                nameKana: data.nameKana || null,
                alias: data.alias || null,
                feeBearer: data.feeBearer || 'them',
                bankName: data.bankName || null,
                branchName: data.branchName || null,
                accountType: data.accountType || null,
                accountNumber: data.accountNumber || null,
                accountHolder: data.accountHolder || null,
                notes: data.notes || null,
                isActive: data.isActive ?? true,
                // 数値は 0 が有効値（paymentMonthOffset 0=当月）なので ?? で null 化する
                closingDay: data.closingDay ?? null,
                paymentMonthOffset: data.paymentMonthOffset ?? null,
                paymentDay: data.paymentDay ?? null,
                updatedBy: session!.user.id,
            },
        });

        return NextResponse.json(newPayee);
    } catch (error) {
        return serverErrorResponse('振込先の作成', error);
    }
}
