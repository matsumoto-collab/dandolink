import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { SUPPLIER_INVOICE_INCLUDE, findMatchingPayee } from '@/lib/supplierInvoice';

interface RouteContext { params: Promise<{ id: string }>; }

// 受け箱の請求書を支払予定(PaymentSchedule)へ追加する。
// 旧・仕入請求書取込の確定ルート（94d02aa で撤去）の Payee 解決＋支払予定作成部分を移植。
// 原価計上（案件配分）は行わない。1請求書 = 支払予定1本。
// body: {
//   paymentDate: 'YYYY-MM-DD',
//   createNewList?: boolean,        // true=新しいリストを作成（listKey を新規発行）
//   targetListKey?: string | null,  // 既存リストに追加する場合のグループキー（null=旧データのリスト）
// }
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json().catch(() => ({}));
        const paymentDateStr = typeof body.paymentDate === 'string' ? body.paymentDate : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDateStr)) return errorResponse('支払日を指定してください', 400);
        const paymentDate = new Date(`${paymentDateStr}T00:00:00.000Z`);
        if (isNaN(paymentDate.getTime())) return errorResponse('支払日が不正です', 400);

        const inv = await prisma.supplierInvoice.findUnique({ where: { id } });
        if (!inv) return notFoundResponse('請求書');
        if (inv.paymentScheduleId) return errorResponse('既に支払予定に追加済みです', 400);
        if (inv.totalAmount == null || Number(inv.totalAmount) <= 0) return errorResponse('金額を入力してください', 400);
        if (!inv.payeeName) return errorResponse('請求元（振込先名）を入力してください', 400);

        // 追加先リスト: 新規作成なら listKey を発行、既存リストならそのキー（null=旧データのリスト）
        const listKey = body.createNewList ? randomUUID() : (body.targetListKey ?? null);

        // 口座種別は Payee の制約に合わせる（'普通'|'当座' 以外は null）
        const accountType = inv.accountType === '普通' || inv.accountType === '当座' ? inv.accountType : null;

        const result = await prisma.$transaction(async (tx) => {
            // 振込先マスター(Payee)を解決: ①既存紐付け ②口座番号 ③支払先名（完全一致）→ 無ければ新規登録
            let payee = await findMatchingPayee(tx, inv);
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

            // 支払予定の口座情報は採用Payeeを優先し、無ければ請求書の抽出値で補完（スナップショット）
            const schedule = await tx.paymentSchedule.create({
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
                    listKey,
                    notes: '請求書取込より作成',
                    updatedBy: session!.user.id,
                },
                include: { payee: true },
            });

            const invoice = await tx.supplierInvoice.update({
                where: { id },
                data: { paymentScheduleId: schedule.id, payeeId: payee.id, updatedBy: session!.user.id },
                include: SUPPLIER_INVOICE_INCLUDE,
            });

            return { schedule, invoice };
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('支払予定への追加', error);
    }
}
