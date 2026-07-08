import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createPaymentScheduleSchema, validateRequest } from '@/lib/validations';
import {
    requireAdmin,
    requireAdminOrAccountant,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';

/**
 * Get payment schedules
 * GET /api/payment-schedules
 * クエリ:
 *   - year: YYYY (例: 2026)
 *   - month: MM (例: 4) ※year必須
 *   - paymentType: 'transfer' | 'payment_slip'
 *   - isPaid: '1' (済のみ) / '0' (未払のみ)
 *   - from: YYYY-MM-DD
 *   - to: YYYY-MM-DD
 */
export async function GET(req: NextRequest) {
    try {
        // 閲覧は税理士(accountant)にも開放。作成(POST)以降は admin のみ（manager には開放しない）
        const { error } = await requireAdminOrAccountant();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');
        const month = searchParams.get('month');
        const paymentType = searchParams.get('paymentType');
        const isPaid = searchParams.get('isPaid');
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        const where: Record<string, unknown> = {};

        // 年月で絞り込み
        if (year) {
            const y = parseInt(year, 10);
            if (!isNaN(y)) {
                if (month) {
                    const m = parseInt(month, 10);
                    if (!isNaN(m) && m >= 1 && m <= 12) {
                        const start = new Date(Date.UTC(y, m - 1, 1));
                        const end = new Date(Date.UTC(y, m, 1));
                        where.paymentDate = { gte: start, lt: end };
                    }
                } else {
                    const start = new Date(Date.UTC(y, 0, 1));
                    const end = new Date(Date.UTC(y + 1, 0, 1));
                    where.paymentDate = { gte: start, lt: end };
                }
            }
        }

        // 期間指定（year/monthより優先）
        if (from || to) {
            const range: Record<string, Date> = {};
            if (from) range.gte = new Date(from);
            if (to) {
                const t = new Date(to);
                t.setUTCDate(t.getUTCDate() + 1);
                range.lt = t;
            }
            where.paymentDate = range;
        }

        if (paymentType === 'transfer' || paymentType === 'payment_slip') {
            where.paymentType = paymentType;
        }

        if (isPaid === '1') where.isPaid = true;
        else if (isPaid === '0') where.isPaid = false;

        const schedules = await prisma.paymentSchedule.findMany({
            where,
            orderBy: [{ paymentDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
            include: { payee: true },
        });

        return NextResponse.json(schedules, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('支払予定の取得', error);
    }
}

/**
 * Create a new payment schedule
 * POST /api/payment-schedules
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(createPaymentScheduleSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const data = validation.data;

        // 振込先が指定されていれば、口座情報をマスターから自動入力（明示指定があればそちら優先）
        let bankName = data.bankName ?? null;
        let branchName = data.branchName ?? null;
        let accountType = data.accountType ?? null;
        let accountNumber = data.accountNumber ?? null;
        let accountHolder = data.accountHolder ?? null;
        let feeFlag = data.feeFlag ?? false;

        if (data.payeeId) {
            const payee = await prisma.payee.findUnique({ where: { id: data.payeeId } });
            if (payee) {
                if (data.bankName === undefined) bankName = payee.bankName;
                if (data.branchName === undefined) branchName = payee.branchName;
                if (data.accountType === undefined) accountType = payee.accountType as '普通' | '当座' | null;
                if (data.accountNumber === undefined) accountNumber = payee.accountNumber;
                if (data.accountHolder === undefined) accountHolder = payee.accountHolder;
                if (data.feeFlag === undefined) feeFlag = payee.feeBearer === 'us';
            }
        }

        const created = await prisma.paymentSchedule.create({
            data: {
                paymentDate: new Date(data.paymentDate),
                paymentType: data.paymentType,
                payeeId: data.payeeId || null,
                payeeName: data.payeeName,
                amount: data.amount,
                feeFlag,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                bankName,
                branchName,
                accountType,
                accountNumber,
                accountHolder,
                isPaid: data.isPaid ?? false,
                notes: data.notes || null,
                sortOrder: data.sortOrder ?? 0,
                listKey: data.listKey || null,
                updatedBy: session!.user.id,
            },
            include: { payee: true },
        });

        return NextResponse.json(created);
    } catch (error) {
        return serverErrorResponse('支払予定の作成', error);
    }
}
