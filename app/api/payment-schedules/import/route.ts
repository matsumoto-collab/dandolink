import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAdmin,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { z } from 'zod';

const payeeImportSchema = z.object({
    name: z.string().min(1),
    feeBearer: z.enum(['us', 'them']).default('them'),
    bankName: z.string().nullable().optional(),
    branchName: z.string().nullable().optional(),
    accountType: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
});

const paymentScheduleImportSchema = z.object({
    paymentDate: z.string(),
    paymentType: z.enum(['transfer', 'payment_slip']),
    payeeName: z.string().min(1),
    amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    feeFlag: z.boolean().default(false),
    dueDate: z.string().nullable().optional(),
    bankName: z.string().nullable().optional(),
    branchName: z.string().nullable().optional(),
    accountType: z.string().nullable().optional(),
    accountNumber: z.string().nullable().optional(),
    accountHolder: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sortOrder: z.number().default(0),
});

const importBodySchema = z.object({
    payees: z.array(payeeImportSchema),
    paymentSchedules: z.array(paymentScheduleImportSchema),
    options: z
        .object({
            // 過去の支払予定を「支払済」として登録するか
            markPastAsPaid: z.boolean().default(true),
            // 過去日の閾値（YYYY-MM-DD）。指定なしなら今日。
            pastThreshold: z.string().optional(),
            // 既存データを削除してからインポート（dry runでは無視）
            wipeExisting: z.boolean().default(false),
            // ドライラン（実際には変更しない、件数だけ返す）
            dryRun: z.boolean().default(false),
        })
        .default({ markPastAsPaid: true, wipeExisting: false, dryRun: false }),
});

/**
 * 支払予定データの一括インポート（管理者のみ）
 * POST /api/payment-schedules/import
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const body = await req.json();
        const parsed = importBodySchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力データが不正です', parsed.error.format());
        }

        const { payees, paymentSchedules, options } = parsed.data;
        const threshold = options.pastThreshold
            ? new Date(options.pastThreshold)
            : new Date();
        const userId = session!.user.id;

        // dryRunなら統計だけ返す
        if (options.dryRun) {
            const existingPayeeCount = await prisma.payee.count();
            const existingScheduleCount = await prisma.paymentSchedule.count();
            const existingPayeeNames = new Set(
                (await prisma.payee.findMany({ select: { name: true } })).map((p) => p.name)
            );
            const newPayeeCount = payees.filter((p) => !existingPayeeNames.has(p.name)).length;
            const pastSchedules = paymentSchedules.filter(
                (ps) => new Date(ps.paymentDate) < threshold
            ).length;
            return NextResponse.json({
                dryRun: true,
                summary: {
                    existingPayees: existingPayeeCount,
                    existingSchedules: existingScheduleCount,
                    payeesToImport: payees.length,
                    payeesNew: newPayeeCount,
                    payeesExisting: payees.length - newPayeeCount,
                    schedulesToImport: paymentSchedules.length,
                    pastSchedules,
                    futureSchedules: paymentSchedules.length - pastSchedules,
                    willMarkAsPaid: options.markPastAsPaid ? pastSchedules : 0,
                },
            });
        }

        // wipeExistingが指定されたら既存データを全削除
        if (options.wipeExisting) {
            await prisma.paymentSchedule.deleteMany({});
            await prisma.payee.deleteMany({});
        }

        // 1. 振込先マスターをアップサート
        let payeeCreated = 0;
        let payeeUpdated = 0;
        const payeeIdByName: Record<string, string> = {};

        // 既存データを取得
        const existingPayees = await prisma.payee.findMany();
        for (const p of existingPayees) {
            payeeIdByName[p.name] = p.id;
        }

        for (const p of payees) {
            const accountType =
                p.accountType === '普通' || p.accountType === '当座' ? p.accountType : null;
            if (payeeIdByName[p.name]) {
                // 既存があれば、足りない情報を追記する形で更新
                const updated = await prisma.payee.update({
                    where: { id: payeeIdByName[p.name] },
                    data: {
                        feeBearer: p.feeBearer,
                        bankName: p.bankName ?? undefined,
                        branchName: p.branchName ?? undefined,
                        accountType: accountType ?? undefined,
                        accountNumber: p.accountNumber ?? undefined,
                        updatedBy: userId,
                    },
                });
                payeeIdByName[p.name] = updated.id;
                payeeUpdated++;
            } else {
                const created = await prisma.payee.create({
                    data: {
                        name: p.name,
                        feeBearer: p.feeBearer,
                        bankName: p.bankName ?? null,
                        branchName: p.branchName ?? null,
                        accountType: accountType,
                        accountNumber: p.accountNumber ?? null,
                        isActive: true,
                        updatedBy: userId,
                    },
                });
                payeeIdByName[p.name] = created.id;
                payeeCreated++;
            }
        }

        // 2. 支払予定を一括作成
        let scheduleCreated = 0;
        let pastMarkedAsPaid = 0;

        // バッチサイズで分割（大量レコード対応）
        const BATCH_SIZE = 100;
        for (let i = 0; i < paymentSchedules.length; i += BATCH_SIZE) {
            const batch = paymentSchedules.slice(i, i + BATCH_SIZE);
            const data = batch.map((ps) => {
                const paymentDate = new Date(ps.paymentDate);
                const isPast = paymentDate < threshold;
                const shouldMarkPaid = options.markPastAsPaid && isPast;
                if (shouldMarkPaid) pastMarkedAsPaid++;

                const accountType =
                    ps.accountType === '普通' || ps.accountType === '当座' ? ps.accountType : null;

                return {
                    paymentDate,
                    paymentType: ps.paymentType,
                    payeeId: payeeIdByName[ps.payeeName] ?? null,
                    payeeName: ps.payeeName,
                    amount: ps.amount,
                    feeFlag: ps.feeFlag,
                    dueDate: ps.dueDate ? new Date(ps.dueDate) : null,
                    bankName: ps.bankName ?? null,
                    branchName: ps.branchName ?? null,
                    accountType: accountType,
                    accountNumber: ps.accountNumber ?? null,
                    accountHolder: ps.accountHolder ?? null,
                    notes: ps.notes ?? null,
                    sortOrder: ps.sortOrder ?? 0,
                    isPaid: shouldMarkPaid,
                    paidAt: shouldMarkPaid ? paymentDate : null,
                    paidBy: shouldMarkPaid ? userId : null,
                    updatedBy: userId,
                };
            });
            await prisma.paymentSchedule.createMany({ data });
            scheduleCreated += data.length;
        }

        return NextResponse.json({
            success: true,
            result: {
                payeeCreated,
                payeeUpdated,
                scheduleCreated,
                pastMarkedAsPaid,
            },
        });
    } catch (error) {
        return serverErrorResponse('支払予定のインポート', error);
    }
}
