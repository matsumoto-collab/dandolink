import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAdmin,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { z } from 'zod';

const copyBodySchema = z.object({
    fromYear: z.number().int().min(2000).max(2100),
    fromMonth: z.number().int().min(1).max(12),
    toYear: z.number().int().min(2000).max(2100),
    toMonth: z.number().int().min(1).max(12),
    paymentTypes: z.array(z.enum(['transfer', 'payment_slip', 'direct_debit'])).optional(),
    // 'tenth'=10日, 'eom'=末日, 'other'=その他の日
    dateTypes: z.array(z.enum(['tenth', 'eom', 'other'])).optional(),
    // ドライラン（実際にコピーせずに件数だけ返す）
    dryRun: z.boolean().default(false),
});

// 月末判定
function isEndOfMonth(d: Date): boolean {
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return next.getMonth() !== d.getMonth();
}

// 月の最終日を取得
function lastDayOfMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

// 元の支払日を新しい月に調整
function adjustDateToNewMonth(sourceDate: Date, toYear: number, toMonth: number): Date {
    const sourceDay = sourceDate.getDate();
    const sourceMonth0 = sourceDate.getMonth();
    const sourceYear = sourceDate.getFullYear();
    const sourceLastDay = lastDayOfMonth(sourceYear, sourceMonth0 + 1);

    let targetDay: number;
    if (sourceDay === sourceLastDay) {
        // 元が月末日なら、コピー先も月末日に
        targetDay = lastDayOfMonth(toYear, toMonth);
    } else {
        // 元と同じ日付。ただし新月の最終日を超える場合は最終日にクリップ
        const targetLastDay = lastDayOfMonth(toYear, toMonth);
        targetDay = Math.min(sourceDay, targetLastDay);
    }

    return new Date(Date.UTC(toYear, toMonth - 1, targetDay));
}

// 日付タイプの判定（10日 / 末日 / その他）
function classifyDate(d: Date): 'tenth' | 'eom' | 'other' {
    if (d.getDate() === 10) return 'tenth';
    if (isEndOfMonth(d)) return 'eom';
    return 'other';
}

/**
 * 別の月から支払予定をコピー
 * POST /api/payment-schedules/copy-from
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const body = await req.json();
        const parsed = copyBodySchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力データが不正です', parsed.error.format());
        }

        const { fromYear, fromMonth, toYear, toMonth, paymentTypes, dateTypes, dryRun } =
            parsed.data;

        // 同じ月なら拒否
        if (fromYear === toYear && fromMonth === toMonth) {
            return validationErrorResponse('コピー元と先が同じ月です');
        }

        // コピー元の月の支払予定を取得
        const fromStart = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
        const fromEnd = new Date(Date.UTC(fromYear, fromMonth, 1));

        const where: Record<string, unknown> = {
            paymentDate: { gte: fromStart, lt: fromEnd },
        };

        const sourceItems = await prisma.paymentSchedule.findMany({
            where,
            orderBy: [{ paymentDate: 'asc' }, { sortOrder: 'asc' }],
        });

        // フィルタ適用（種別・日付タイプ）
        const typeSet = paymentTypes ? new Set(paymentTypes) : null;
        const dateTypeSet = dateTypes ? new Set(dateTypes) : null;

        const filtered = sourceItems.filter((item) => {
            if (typeSet && !typeSet.has(item.paymentType as 'transfer' | 'payment_slip' | 'direct_debit')) {
                return false;
            }
            if (dateTypeSet) {
                const dt = classifyDate(new Date(item.paymentDate));
                if (!dateTypeSet.has(dt)) return false;
            }
            return true;
        });

        // コピー先の既存件数も取得（参考情報として）
        const toStart = new Date(Date.UTC(toYear, toMonth - 1, 1));
        const toEnd = new Date(Date.UTC(toYear, toMonth, 1));
        const existingTargetCount = await prisma.paymentSchedule.count({
            where: { paymentDate: { gte: toStart, lt: toEnd } },
        });

        if (dryRun) {
            // 種別ごとの件数を集計
            const summary = {
                sourceTotal: sourceItems.length,
                eligibleTotal: filtered.length,
                tenth: filtered.filter((i) => classifyDate(new Date(i.paymentDate)) === 'tenth').length,
                eom: filtered.filter((i) => classifyDate(new Date(i.paymentDate)) === 'eom').length,
                other: filtered.filter((i) => classifyDate(new Date(i.paymentDate)) === 'other').length,
                transfer: filtered.filter((i) => i.paymentType === 'transfer').length,
                paymentSlip: filtered.filter((i) => i.paymentType === 'payment_slip').length,
                directDebit: filtered.filter((i) => i.paymentType === 'direct_debit').length,
                existingTargetCount,
            };
            return NextResponse.json({ dryRun: true, summary });
        }

        // 一件もない場合
        if (filtered.length === 0) {
            return NextResponse.json({
                success: true,
                created: 0,
                message: 'コピー対象の支払予定が見つかりませんでした',
            });
        }

        // データを生成（新しい支払日 + 「未払」状態でコピー）
        // 元のリスト構成（支払日×listKey）を保ったまま、コピー先には新しいリストキーを割り当てる
        const userId = session!.user.id;
        const newListKeyBySourceGroup = new Map<string, string>();
        const data = filtered.map((item) => {
            const newDate = adjustDateToNewMonth(new Date(item.paymentDate), toYear, toMonth);
            const sourceGroup = `${new Date(item.paymentDate).toISOString().slice(0, 10)}::${item.listKey ?? ''}`;
            let listKey = newListKeyBySourceGroup.get(sourceGroup);
            if (!listKey) {
                listKey = randomUUID();
                newListKeyBySourceGroup.set(sourceGroup, listKey);
            }
            return {
                paymentDate: newDate,
                listKey,
                paymentType: item.paymentType,
                payeeId: item.payeeId,
                payeeName: item.payeeName,
                amount: item.amount,
                feeFlag: item.feeFlag,
                dueDate: null, // 期日は新しく入れ直してもらう
                bankName: item.bankName,
                branchName: item.branchName,
                accountType: item.accountType,
                accountNumber: item.accountNumber,
                accountHolder: item.accountHolder,
                isPaid: false, // コピー先は必ず未払
                paidAt: null,
                paidBy: null,
                notes: item.notes,
                sortOrder: item.sortOrder,
                updatedBy: userId,
            };
        });

        // 一括作成
        await prisma.paymentSchedule.createMany({ data });

        return NextResponse.json({
            success: true,
            created: data.length,
        });
    } catch (error) {
        return serverErrorResponse('支払予定のコピー', error);
    }
}
