import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { JoyoRejectError } from '@/lib/joyoStatementServer';
import { okResponse, requireJoyoAdmin } from '../../_shared';

export const dynamic = 'force-dynamic';

const NO_PAYEE_MESSAGE =
    '振込先が登録されていません（または利用停止です）。『対象者・書類の設定』で振込先を選んでください';

/**
 * POST /api/joyo-statements/[id]/add-to-schedule
 * 発行済みの明細から支払予定（PaymentSchedule）を1行作る（admin 限定。指示書 3-4）。
 *
 * body: {
 *   createNewList?: boolean,        // true=新しいリストを作る（listKey を新しく発行）
 *   targetListKey?: string | null,  // 既存リストに足すときのグループキー（null=旧データのリスト）
 * }
 * 支払日は受け取らない（明細の支払日を使う）。振込先マスターの行はここでは作らない
 * （同じ人の口座の無い行が増えた原因が、請求書取込の自動登録とみられるため）。
 * 返り値の id は明細の id（画面は成功のたびに一覧を取り直す）。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => ({}));
        const createNewList = body?.createNewList === true;
        const rawKey = body?.targetListKey ?? null;
        if (rawKey !== null && (typeof rawKey !== 'string' || rawKey.length > 64)) {
            return errorResponse('追加先のリストが不正です', 400);
        }
        // 新しいリストなら listKey を発行、既存リストならそのキー（null=旧データのリスト）
        const listKey: string | null = createNewList ? randomUUID() : rawKey;

        const statement = await prisma.joyoStatement.findUnique({
            where: { id: params.id },
            select: { id: true, status: true, contractorId: true },
        });
        if (!statement) return notFoundResponse('支払明細書');
        if (statement.status !== 'issued') return errorResponse('発行済みにしてから追加してください', 400);

        const contractor = await prisma.joyoContractor.findUnique({
            where: { id: statement.contractorId },
            select: { payeeId: true },
        });
        if (!contractor?.payeeId) return errorResponse(NO_PAYEE_MESSAGE, 400);
        const payee = await prisma.payee.findUnique({ where: { id: contractor.payeeId } });
        if (!payee || !payee.isActive) return errorResponse(NO_PAYEE_MESSAGE, 400);

        const userId = session?.user?.id ?? null;

        // 二重押し・同時の呼び出しで2行できないよう、読み直し → 作成 → 条件つき更新 を1つのトランザクションで行う
        await prisma.$transaction(async (tx) => {
            const current = await tx.joyoStatement.findUnique({
                where: { id: statement.id },
                select: {
                    id: true,
                    status: true,
                    year: true,
                    month: true,
                    paymentDate: true,
                    total: true,
                    paymentScheduleId: true,
                },
            });
            if (!current || current.status !== 'issued') {
                throw new JoyoRejectError('発行済みにしてから追加してください');
            }
            // 先の行が残っていれば追加済み。消されていれば（古い ID が残っているだけなら）未追加として扱う
            if (current.paymentScheduleId) {
                const existing = await tx.paymentSchedule.findUnique({
                    where: { id: current.paymentScheduleId },
                    select: { id: true },
                });
                if (existing) throw new JoyoRejectError('既に支払予定に追加済みです');
            }

            // 口座・手数料負担は Payee から写す（supplier-invoices/[id]/add-to-schedule と同じ写し方）
            const schedule = await tx.paymentSchedule.create({
                data: {
                    // @db.Date の値（UTC 0時）をそのまま
                    paymentDate: current.paymentDate,
                    paymentType: 'transfer',
                    payeeId: payee.id,
                    payeeName: payee.name,
                    amount: current.total,
                    feeFlag: payee.feeBearer === 'us',
                    bankName: payee.bankName,
                    branchName: payee.branchName,
                    accountType: payee.accountType,
                    accountNumber: payee.accountNumber,
                    accountHolder: payee.accountHolder,
                    listKey,
                    notes: `支払明細書より作成（${current.year}年${current.month}月分）`,
                    updatedBy: userId,
                },
                select: { id: true },
            });

            // 読んだときの paymentScheduleId のままなら紐付ける。違えば（同時に追加された）全体を取り消す
            const linked = await tx.joyoStatement.updateMany({
                where: { id: current.id, paymentScheduleId: current.paymentScheduleId },
                data: { paymentScheduleId: schedule.id },
            });
            if (linked.count !== 1) throw new JoyoRejectError('既に支払予定に追加済みです');
        });

        return okResponse(statement.id);
    } catch (error) {
        if (error instanceof JoyoRejectError) return errorResponse(error.message, 400);
        return serverErrorResponse('支払明細書の支払予定への追加', error);
    }
}
