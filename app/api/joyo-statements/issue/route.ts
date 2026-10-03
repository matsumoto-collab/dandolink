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
import { joyoStatementSaveSchema } from '@/lib/validations/joyoStatement';
import { buildStatementNo, countJoyoDays, paidDaysChanged } from '@/lib/joyoStatement';
import {
    JoyoRejectError,
    buildStatementWriteData,
    loadJoyoIssuer,
    loadJoyoSettings,
    loadMonthAttendanceByUser,
    prepareStatementItems,
    todayJstYmd,
} from '@/lib/joyoStatementServer';
import type { JoyoIssuedSnapshot } from '@/types/joyoStatement';
import { okResponse, requireJoyoAdmin } from '../_shared';

export const dynamic = 'force-dynamic';

const ALREADY_ISSUED_MESSAGE = 'すでに発行済みです';

/**
 * POST /api/joyo-statements/issue
 * 保存して発行済みにする（1回の呼び出しで両方。admin 限定）。入力は PUT /api/joyo-statements と同じ。
 *
 * 断る条件を先に全部調べ、断るときは何も保存しない（400）。
 * 発行の瞬間に「書類の名前・注意書き・宛名・自社情報・出勤簿（対象月）」を issuedSnapshot に写して固定する。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(joyoStatementSaveSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const input = parsed.data;
        const { year, month } = input;

        const contractor = await prisma.joyoContractor.findUnique({ where: { id: input.contractorId } });
        if (!contractor) return notFoundResponse('対象者');

        const key = { contractorId: contractor.id, year, month };
        const existing = await prisma.joyoStatement.findUnique({
            where: { contractorId_year_month: key },
            select: { id: true, status: true },
        });
        if (existing?.status === 'issued') return errorResponse(ALREADY_ISSUED_MESSAGE, 400);

        const prepared = prepareStatementItems(input.items);
        if (!prepared.ok) return errorResponse(prepared.message, 400);
        if (prepared.total <= 0) return errorResponse('合計金額が 0 円以下のため発行できません', 400);

        const [issuer, settings, user, attendanceByUser] = await Promise.all([
            loadJoyoIssuer(),
            loadJoyoSettings(),
            prisma.user.findUnique({ where: { id: contractor.userId }, select: { displayName: true } }),
            loadMonthAttendanceByUser([contractor.userId], year, month),
        ]);
        if (!issuer) return errorResponse('自社情報が登録されていません', 400);

        // 画面に出ていた日数と今の出勤簿が違えば断る（1ページ目の日数と2ページ目の出勤簿が食い違った書類を作らない）
        const records = attendanceByUser.get(contractor.userId) ?? [];
        const counts = countJoyoDays(year, month, records, todayJstYmd());
        if (paidDaysChanged(input.seenCounts, counts)) {
            return errorResponse('編集中に出勤簿が変わりました。画面を閉じて開き直し、日数を確かめてください', 400);
        }

        const snapshot: JoyoIssuedSnapshot = {
            title: settings.title,
            footerNote: settings.footerNote,
            recipient: {
                name: contractor.recipientName,
                honorific: contractor.honorific,
                postalCode: contractor.postalCode,
                address: contractor.address,
                registrationNumber: contractor.registrationNumber,
            },
            issuer,
            attendanceUserName: user?.displayName ?? '',
            attendanceRecords: records,
        };

        const userId = session?.user?.id ?? null;
        const data = {
            ...buildStatementWriteData(input, prepared, userId),
            status: 'issued',
            issuedAt: new Date(),
            issuedBy: userId,
            issuedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        };

        // 保存と発行を一度に行う。確かめてから書くまでのあいだに別タブで発行された場合は、updateMany の条件で弾く
        const savedId = await prisma.$transaction(async (tx) => {
            const current = await tx.joyoStatement.findUnique({
                where: { contractorId_year_month: key },
                select: { id: true, status: true, statementNo: true },
            });
            if (current?.status === 'issued') throw new JoyoRejectError(ALREADY_ISSUED_MESSAGE);
            // 書類番号は最初に発行したときに付け、発行し直しても変えない
            const statementNo = current?.statementNo || buildStatementNo(year, month, contractor.code);

            if (!current) {
                const created = await tx.joyoStatement.create({
                    data: { ...key, ...data, statementNo },
                    select: { id: true },
                });
                return created.id;
            }
            const updated = await tx.joyoStatement.updateMany({
                where: { id: current.id, status: 'draft' },
                data: { ...data, statementNo },
            });
            if (updated.count !== 1) throw new JoyoRejectError(ALREADY_ISSUED_MESSAGE);
            return current.id;
        });

        return okResponse(savedId);
    } catch (error) {
        if (error instanceof JoyoRejectError) return errorResponse(error.message, 400);
        return serverErrorResponse('支払明細書の発行', error);
    }
}
