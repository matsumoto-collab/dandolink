import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { okResponse, requireJoyoAdmin } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/joyo-statements/[id]/unissue
 * 発行を取り消して下書きに戻す（admin 限定）。書類番号は残す（もう一度発行しても同じ番号）。
 *
 * 支払予定に追加済みで、その行がまだあるときは取り消せない
 * （支払済みなら取り消せない／未払いなら先に「支払予定」でその行を消してもらう）。
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const statement = await prisma.joyoStatement.findUnique({
            where: { id: params.id },
            select: { id: true, status: true, paymentScheduleId: true },
        });
        if (!statement) return notFoundResponse('支払明細書');
        if (statement.status !== 'issued') return errorResponse('発行済みの明細ではありません', 400);

        if (statement.paymentScheduleId) {
            const schedule = await prisma.paymentSchedule.findUnique({
                where: { id: statement.paymentScheduleId },
                select: { id: true, isPaid: true },
            });
            if (schedule) {
                if (schedule.isPaid) return errorResponse('支払済みのため、発行を取り消せません', 400);
                return errorResponse(
                    '支払予定に追加済みです。先に『支払予定』でこの行を削除してから、発行を取り消してください',
                    400,
                );
            }
        }

        // paymentScheduleId は先の行が無くなっているので null に戻す。
        // 確かめてから書くまでのあいだに支払予定へ追加された場合は、paymentScheduleId の条件で弾く
        const updated = await prisma.joyoStatement.updateMany({
            where: { id: statement.id, status: 'issued', paymentScheduleId: statement.paymentScheduleId },
            data: {
                status: 'draft',
                issuedSnapshot: Prisma.DbNull,
                issuedAt: null,
                issuedBy: null,
                paymentScheduleId: null,
                updatedBy: session?.user?.id ?? null,
            },
        });
        if (updated.count !== 1) {
            return errorResponse('明細の状態が変わりました。画面を開き直してください', 400);
        }

        return okResponse(statement.id);
    } catch (error) {
        return serverErrorResponse('支払明細書の発行の取り消し', error);
    }
}
