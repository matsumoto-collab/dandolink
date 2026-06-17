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
        const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { allocations: true } });
        if (!inv) return notFoundResponse('仕入請求書');
        if (inv.status === 'confirmed') return errorResponse('既に確定済みです', 400);

        // 支払予定に必要な項目の検証
        if (inv.totalAmount == null || Number(inv.totalAmount) <= 0) return errorResponse('税込金額を入力してください', 400);
        if (!inv.payeeName) return errorResponse('支払先を入力してください', 400);

        // 原価計上に必要な案件配分の検証
        const allocations = inv.allocations;
        if (allocations.length === 0) return errorResponse('案件への配分を1件以上入力してください', 400);
        for (const al of allocations) {
            if (!al.projectMasterId) return errorResponse('配分の案件をすべて選択してください', 400);
            if (!al.expenseCategoryId) return errorResponse('配分の費目をすべて選択してください', 400);
            if (al.amount == null || Number(al.amount) <= 0) return errorResponse('配分の金額をすべて入力してください', 400);
        }
        const allocTotal = allocations.reduce((s, al) => s + Number(al.amount || 0), 0);
        if (allocTotal !== Number(inv.totalAmount)) {
            return errorResponse(`配分の合計¥${allocTotal.toLocaleString()}が税込金額¥${Number(inv.totalAmount).toLocaleString()}と一致しません`, 400);
        }

        // 振込日: 支払期日 → 発行日 → 今日 の順で採用
        const paymentDate = inv.dueDate ?? inv.issueDate ?? new Date();
        // 口座種別は Payee の制約に合わせる（'普通'|'当座' 以外は null）
        const accountType = inv.accountType === '普通' || inv.accountType === '当座' ? inv.accountType : null;

        const result = await prisma.$transaction(async (tx) => {
            // 振込先マスター(Payee)を解決：①既存紐付け ②口座番号/支払先名で照合 ③無ければ新規作成
            let payee = inv.payeeId ? await tx.payee.findUnique({ where: { id: inv.payeeId } }) : null;
            if (!payee && inv.accountNumber) {
                payee = await tx.payee.findFirst({ where: { isActive: true, accountNumber: inv.accountNumber } });
            }
            if (!payee) {
                payee = await tx.payee.findFirst({ where: { isActive: true, name: inv.payeeName! } });
            }
            if (!payee) {
                payee = await tx.payee.create({
                    data: {
                        name: inv.payeeName!,
                        nameKana: inv.payeeKana,
                        bankName: inv.bankName,
                        branchName: inv.branchName,
                        accountType,
                        accountNumber: inv.accountNumber,
                        accountHolder: inv.accountHolder,
                        feeBearer: 'them',
                        updatedBy: session!.user.id,
                    },
                });
            }

            // 支払予定の口座情報は採用Payeeを優先し、無ければ請求書の抽出値で補完
            const ps = await tx.paymentSchedule.create({
                data: {
                    paymentDate,
                    paymentType: 'transfer',
                    payeeId: payee.id,
                    payeeName: inv.payeeName!,
                    amount: inv.totalAmount!,
                    feeFlag: payee.feeBearer === 'us',
                    dueDate: inv.dueDate,
                    bankName: payee.bankName ?? inv.bankName,
                    branchName: payee.branchName ?? inv.branchName,
                    accountType: payee.accountType ?? accountType,
                    accountNumber: payee.accountNumber ?? inv.accountNumber,
                    accountHolder: payee.accountHolder ?? inv.accountHolder,
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
                    payeeId: payee.id,
                },
                include: INVOICE_INCLUDE,
            });
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('仕入請求書の確定', error);
    }
}
