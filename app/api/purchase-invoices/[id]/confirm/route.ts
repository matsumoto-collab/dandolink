import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { INVOICE_INCLUDE } from '@/lib/purchaseInvoice';

interface RouteContext { params: Promise<{ id: string }>; }

// 仕入請求書を確定する。
//  ① status を 'confirmed' にする（→ 原価エンジンが案件原価に集計）
//  ② 振込予定表(PaymentSchedule)に支払予定を自動作成する
// 原価・支払いに関わるため admin のみ。
export async function POST(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const { id } = await context.params;
        const inv = await prisma.purchaseInvoice.findUnique({ where: { id } });
        if (!inv) return notFoundResponse('仕入請求書');
        if (inv.status === 'confirmed') return errorResponse('既に確定済みです', 400);

        // 原価・支払予定に必要な項目の検証
        if (!inv.projectMasterId) return errorResponse('紐付け案件を選択してください', 400);
        if (!inv.expenseCategoryId) return errorResponse('費目を選択してください', 400);
        if (inv.totalAmount == null || Number(inv.totalAmount) <= 0) return errorResponse('税込金額を入力してください', 400);
        if (!inv.payeeName) return errorResponse('支払先を入力してください', 400);

        // 振込日: 支払期日 → 発行日 → 今日 の順で採用
        const paymentDate = inv.dueDate ?? inv.issueDate ?? new Date();

        // 振込先マスターから口座情報を補完
        let bankName: string | null = null;
        let branchName: string | null = null;
        let accountType: string | null = null;
        let accountNumber: string | null = null;
        let accountHolder: string | null = null;
        let feeFlag = false;
        if (inv.payeeId) {
            const payee = await prisma.payee.findUnique({ where: { id: inv.payeeId } });
            if (payee) {
                bankName = payee.bankName;
                branchName = payee.branchName;
                accountType = payee.accountType;
                accountNumber = payee.accountNumber;
                accountHolder = payee.accountHolder;
                feeFlag = payee.feeBearer === 'us';
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            const ps = await tx.paymentSchedule.create({
                data: {
                    paymentDate,
                    paymentType: 'transfer',
                    payeeId: inv.payeeId,
                    payeeName: inv.payeeName!,
                    amount: inv.totalAmount!,
                    feeFlag,
                    dueDate: inv.dueDate,
                    bankName,
                    branchName,
                    accountType,
                    accountNumber,
                    accountHolder,
                    notes: '仕入請求書より自動作成',
                    updatedBy: session!.user.id,
                },
            });
            return tx.purchaseInvoice.update({
                where: { id },
                data: {
                    status: 'confirmed',
                    confirmedAt: new Date(),
                    confirmedBy: session!.user.id,
                    paymentScheduleId: ps.id,
                },
                include: INVOICE_INCLUDE,
            });
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('仕入請求書の確定', error);
    }
}
